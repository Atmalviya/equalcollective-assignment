# X-Ray System Architecture

## Overview

X-Ray captures decision context in multi-step pipelines: what candidates were considered, what filters were applied, and why specific outputs were chosen. Traditional tracing shows function calls and timing; X-Ray shows business logic decisions.

## Data Model

### Core Entities

```
Run
├── id (UUID)
├── pipelineName (string)
├── status (running|success|failed|partial)
├── startedAt, endedAt (timestamps)
├── metadata (JSONB - arbitrary key-value pairs)
└── steps[] (ordered collection)

Step
├── id (UUID)
├── runId (FK → Run)
├── stepName (string - semantic: "filter_candidates")
├── stepType (llm|filter|retrieval|ranking|selection|other)
├── order (int - sequence within run)
├── status (success|failed|skipped)
├── startedAt, endedAt (timestamps)
├── metrics (JSONB - e.g., {candidateCountBefore: 5000, dropRate: 0.994})
├── summary (string - human-readable summary)
└── stepDetails (1:1 relationship)

StepDetails
├── stepId (FK → Step, unique)
├── input (JSONB - what the step received)
├── output (JSONB - what the step produced)
├── reasoning (JSONB - why decisions were made)
├── filtersApplied (JSONB[] - per-filter stats)
├── candidatesSample (JSONB[] - sampled candidates)
└── candidatesStats (JSONB - aggregates)
```

### Design Rationale

**Why separate `Step` and `StepDetails`?**

Most queries are like "all filter steps with dropRate > 0.9". For this, you scan `Step` (indexed fields: stepType, stepName, metrics). You don't need the full input/output JSON blobs.

When debugging a specific step, you fetch `StepDetails` (large JSONB fields). This separation means:
- List queries are fast (scan lightweight `Step` table)
- Drill-down queries fetch details only when needed
- Indexes stay small (on `Step`, not JSONB blobs)

**Alternative**: Single table. **Rejected** because PostgreSQL JSONB path queries on large payloads are slow, and indexing JSONB is expensive. The 80/20 split (most queries are lists, few are drill-downs) justifies the join cost.

**Why `stepType` as an enum?**

Cross-pipeline queries require standardization. "Show all filter steps" only works if all pipelines tag filter steps the same way. An enum enforces this.

**Alternative**: Free-form string like "filter_candidates" or "price_filter". **Rejected** because you can't query across pipelines without conventions developers might ignore. The enum trades flexibility for queryability—worth it

**Why JSONB for `metadata` and `metrics`?**

Different pipelines need different fields: competitor selection tracks `productId`, recommendation systems track `userId`, A/B tests track `experimentId`. A fixed schema doesn't work.

JSONB lets each pipeline store what it needs while still being queryable via PostgreSQL's JSONB path operators (`metrics->>'dropRate'`). The trade-off: developers must use consistent key names for cross-pipeline queries (documented conventions, not enforced).

## System Design

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│   SDK       │────────▶│  Event Queue │────────▶│  API Server │
│  (Client)   │  Events │  (Batching)  │  HTTP   │  (Express)  │
└─────────────┘         └──────────────┘         └──────┬───────┘
                                                        │
                                                        ▼
                                                ┌───────────────┐
                                                │  PostgreSQL   │
                                                │  + JSONB      │
                                                └───────────────┘
```

### SDK Architecture

Events are queued in-memory and batched (50 events or 5 seconds, whichever comes first). Batches are sent asynchronously—the pipeline never waits for network calls.

If the backend is unavailable, the SDK retries up to 5 times, then drops events and logs a warning. The pipeline continues normally (fail-open).

Developers configure per-step what to capture: full data, sampled (top-K or random), or summary-only (aggregates, no individual items).

### API Architecture

**Ingest**: `POST /xray/events` accepts batched events. Events are idempotent (upsert by ID), so retries are safe.

**Query**: Three access patterns:
- `GET /xray/runs` - List runs (includes steps, excludes stepDetails for performance)
- `GET /xray/runs/:runId` - Full run with stepDetails
- `POST /xray/query/steps` - Cross-pipeline step queries (filters on stepType, metrics via JSONB paths)

## Debugging Walkthrough: Phone Case → Laptop Stand

**Scenario**: A competitor selection run incorrectly matches a phone case to a laptop stand.

**Investigation steps**:

1. **Find the run**: Query `GET /xray/runs?pipelineName=competitor_selection&metadata.productId=phone_case_123`
2. **View timeline**: The run shows 5 steps:
   - `generate_keywords` (LLM, success)
   - `retrieve_candidates` (retrieval, 20k → 5k)
   - `filter_candidates` (filter, 5k → 30, dropRate: 0.994)
   - `rank_candidates` (LLM ranking, top: laptop_stand)
   - `select_best` (selection)

3. **Inspect `filter_candidates` step**:
   - `GET /xray/runs/{runId}/steps/{stepId}` where stepName="filter_candidates"
   - **Metrics**: `candidateCountBefore: 5000, candidateCountAfter: 30, dropRate: 0.994`
   - **filtersApplied**: Shows a category filter with `afterCount: 2000` but then another filter dropped to 30
   - **candidatesSample**: Shows mostly laptop stands, not phone accessories
   - **Root cause**: Category filter misconfigured to allow "Laptop Accessories" instead of "Phone Accessories"

4. **Verify with `generate_keywords`**: Check if keywords were wrong (they weren't—keywords were correct).

**Conclusion**: The filter step eliminated 99.4% of candidates, leaving only laptop stands. The ranking step then selected the "best" laptop stand, but it was the wrong category entirely.

## Queryability

### Cross-Pipeline Queries

**Query**: "Show all runs where filtering eliminated >90% of candidates"

**Implementation**:
```http
POST /xray/query/steps
{
  "filters": [
    { "field": "stepType", "op": "eq", "value": "filter" },
    { "field": "metrics.dropRate", "op": "gt", "value": 0.9 }
  ],
  "include": ["run", "step"]
}
```

**Conventions** (documented, not enforced):
1. Tag filter steps as `stepType: 'filter'`
2. Log `metrics.dropRate` or `metrics.candidateCountBefore/After` for filter steps
3. Use semantic stepNames (e.g., `filter_candidates`, not `step3`)

**Why this works**: `stepType` is standardized (enum), so cross-pipeline queries are possible. `metrics` structure is convention-based—different pipelines can use different keys, but common ones (like `dropRate`) enable cross-pipeline analysis.

**Handling variability**: Pipelines without "candidates" can still be queried by `stepType` and `stepName`. Metrics are optional—the query API supports flexible JSONB path queries for whatever structure developers use.

## Performance & Scale

### Problem: 5,000 candidates → 30, logging everything is expensive

**Solution**: Multi-layered approach

1. **SDK-level sampling** (developer-controlled):
   ```typescript
   run.step('filter', 'filter', fn, {
     capture: {
       candidates: { mode: 'sample', max: 100, strategy: 'top' },
       rejectionReasons: 'summary-only'
     }
   });
   ```

2. **Summarization**:
   - Instead of full candidates array, store aggregates: `candidatesStats: { priceHistogram: {...}, ratingDistribution: {...} }`
   - Store only top-K candidates in `candidatesSample`

3. **Backend limits**:
   - Max event size: 10MB (enforced in API)
   - Max queue size: 10,000 events (SDK drops oldest if exceeded)

**Trade-offs**: Full capture gives perfect debugging but is expensive (5,000 candidates × JSON size). Sampling top-100 gives 80% of debugging value at ~2% of cost. Developer configures per-step; system enforces hard limits (10MB max event size, 10K max queue size).

**Production considerations**: Tiered storage (hot/warm/cold) with archival to S3 for older data. Materialized views for common queries. Read replicas for query API.

## Developer Experience

### Minimal Instrumentation (<30 minutes)

**Before**:
```typescript
async function competitorSelection(product) {
  const keywords = await generateKeywords(product);
  const candidates = await retrieveCandidates(keywords);
  const filtered = await filterCandidates(candidates);
  const ranked = await rankCandidates(filtered);
  return ranked[0];
}
```

**After**:
```typescript
import { XRayClient } from '@equal/xray-js';

const xray = new XRayClient({
  baseUrl: process.env.XRAY_BASE_URL || 'http://localhost:3000'
});

async function competitorSelection(product) {
  const run = xray.startRun({
    pipelineName: 'competitor_selection',
    metadata: { productId: product.id }
  });

  return run.execute(async () => {
    const keywords = await run.step('generate_keywords', 'llm', () =>
      generateKeywords(product)
    );
    const candidates = await run.step('retrieve_candidates', 'retrieval', () =>
      retrieveCandidates(keywords)
    );
    const filtered = await run.step('filter_candidates', 'filter', (ctx) => {
      const result = filterCandidates(candidates);
      ctx.record({
        metrics: {
          candidateCountBefore: candidates.length,
          candidateCountAfter: result.length,
          dropRate: 1 - result.length / candidates.length
        }
      });
      return result;
    });
    const ranked = await run.step('rank_candidates', 'ranking', () =>
      rankCandidates(filtered)
    );
    return run.step('select_best', 'selection', () => ranked[0]);
  });
}
```

**Result**: Run timeline, step timings, basic metrics. Enough to see where time is spent and where failures occur.

### Full Instrumentation

Add detailed context:
```typescript
await run.step('filter_candidates', 'filter', async (ctx) => {
  const filters = [
    { name: 'price_range', params: { min: 10, max: 100 } },
    { name: 'category_match', params: { category: product.category } }
  ];
  
  const results = filters.reduce((acc, filter) => {
    const before = acc.length;
    const after = applyFilter(acc, filter);
    return after;
  }, candidates);

  ctx.record({
    input: { candidates: candidates.length },
    output: { candidates: results.length },
    filtersApplied: filters.map(f => ({
      name: f.name,
      params: f.params,
      beforeCount: /* ... */,
      afterCount: /* ... */,
      dropRate: /* ... */
    })),
    candidatesSample: results.slice(0, 10),
    metrics: { /* ... */ }
  });

  return results;
}, { input: { candidates } });
```

### Backend Unavailable Behavior

**SDK behavior**: Events queue in-memory (up to 10,000). On send failure, retry with exponential backoff (max 5 attempts). After 5 failures, drop events, log warning, continue pipeline. Pipeline never breaks due to X-Ray.

**Configuration**:
```typescript
const xray = new XRayClient({
  failOpen: true,
  maxQueueSize: 10000,
  batchSize: 50,
  flushInterval: 5000
});
```

## Real-World Application

**Example**: DeFi arbitrage bot that sometimes takes bad trades.

**Problem**: Debugging requires tracing: price oracle queries (multiple sources, non-deterministic), liquidity checks (varies by DEX), risk filters (slippage/gas thresholds), route optimization (multiple paths considered), final execution decision.

**Without X-Ray**: Logs show "executed trade" but not why route A was chosen over route B, or which risk filter eliminated profitable opportunities.

**With X-Ray**: Wrap each step—oracle queries log all sources and prices, risk filters log rejection reasons, route optimization logs all considered paths with scores. When a bad trade occurs, you see exactly which oracle returned stale data, which filter was too conservative, or which route calculation was wrong.

**Key insight**: Non-deterministic steps (oracle prices, liquidity) combined with multiple decision points make "why" questions hard to answer without structured context capture.

## What Next?

**Priority 1**: Visual dashboard (timeline view, step drill-down, query builder). 

**Priority 2**: Advanced querying—time-series analysis (dropRate trends), anomaly detection (steps deviating from patterns), correlation analysis (which steps correlate with failures?).

**Priority 3**: Multi-language SDKs (Python, Java, Go). Same event schema, different language bindings. Most pipelines aren't Node.js.

**Nice-to-have**: OpenTelemetry integration (attach runId to traces), log aggregation (correlate with app logs), streaming ingestion (Kafka → processing → DB), per-tenant isolation.

**Performance**: Read replicas for query API, materialized views for common queries, tiered storage (hot/warm/cold).

## API Specification

### Ingest

**POST /xray/events**
- Body: `{ events: XRayEvent[] }`
- Response: `{ success: boolean, processed: number }`
- Note: Authentication disabled for local development

### Query

**GET /xray/runs**
- Query params: `pipelineName`, `status`, `startDate`, `endDate`, `limit`, `offset`
- Response: `{ runs: Run[] }`

**GET /xray/runs/:runId**
- Response: `{ run: Run }` (includes steps)

**GET /xray/runs/:runId/steps/:stepId**
- Response: `{ step: Step }` (includes stepDetails)

**POST /xray/query/steps**
- Body: `{ filters: Filter[], include: string[], limit: number, offset: number }`
- Response: `{ steps: Step[], count: number }`

---

**Summary**: X-Ray separates lightweight step metadata (for fast queries) from heavy details (for drill-down), uses conventions (stepType enum, metrics structure) to enable cross-pipeline queries, and prioritizes fail-open behavior so observability never breaks production systems.

