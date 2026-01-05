# X-Ray SDK & API

A general-purpose SDK and API for debugging multi-step, non-deterministic algorithmic systems. X-Ray answers "why did the system make this decision?" rather than just "what happened?"

## Overview

X-Ray provides transparency into decision-making processes across multi-step pipelines. It captures:
- **Inputs** and **outputs** at each step
- **Candidates** considered and **filters** applied
- **Reasoning** behind decisions (especially for LLM-based steps)
- **Metrics** and **timing** for performance analysis

Unlike traditional tracing (Jaeger, Zipkin), X-Ray focuses on **business logic decisions** rather than function calls.

## Project Structure

```
.
├── sdk/              # TypeScript SDK
│   ├── src/
│   └── package.json
├── api/              # Backend API server
│   ├── src/
│   ├── prisma/
│   └── package.json
├── examples/         # Example usage
├── ARCHITECTURE.md   # System design and rationale
└── README.md         # This file
```

## Setup Instructions

### 1. Set Up the API

```bash
cd api

# Install dependencies
npm install

# Example .env file
# DATABASE_URL="postgresql://user:password@localhost:5432/xray_db"

# Set up database
npx prisma generate
npx prisma migrate dev

# Start the server
npm run dev
```

The API will run on `http://localhost:3000`

### 2. Install the SDK

```bash
cd sdk

# Install dependencies
npm install

# Build the SDK
npm run build
```

### 3. Use the SDK in Your Code

```typescript
import { XRayClient } from '../sdk/dist';

const xray = new XRayClient({
  baseUrl: 'http://localhost:3000',
  defaultMetadata: {
    service: 'my-service',
    env: 'production'
  }
});

// Wrap your pipeline
async function myPipeline(input) {
  const run = xray.startRun({
    pipelineName: 'my_pipeline',
    metadata: { inputId: input.id }
  });

  return run.execute(async () => {
    const step1Result = await run.step('step1', 'llm', async (ctx) => {
      const result = await callLLM(ctx.input);
      ctx.record({
        output: result,
        reasoning: result.explanation
      });
      return result;
    }, { input: { prompt: input.prompt } });

    const step2Result = await run.step('step2', 'filter', async (ctx) => {
      const filtered = filterResults(ctx.input.candidates);
      ctx.record({
        metrics: {
          candidateCountBefore: ctx.input.candidates.length,
          candidateCountAfter: filtered.length,
          dropRate: 1 - filtered.length / ctx.input.candidates.length
        }
      });
      return filtered;
    }, { input: { candidates: step1Result } });

    return step2Result;
  });
}
```

## Examples

### Simple Examples

- **`examples/test.ts`** - Basic test script
- **`examples/minimal-example.ts`** - Minimal instrumentation (<5 minutes)

### Complex Examples

- **`examples/competitor-selection.ts`** - Competitor selection pipeline with 5 steps
- **`examples/complex-pipeline.ts`** - **E-commerce recommendation system** with:
  - 10,000+ product catalog
  - 6 different step types (LLM, retrieval, filter, ranking, selection)
  - Complex multi-stage filtering
  - LLM-based relevance ranking
  - Diversity-aware selection
  - Detailed metrics and reasoning at each step

Run the complex example:
```bash
cd examples
npm run complex
# or
ts-node --transpile-only complex-pipeline.ts
```

## API Endpoints

### Ingest

- **POST /xray/events** - Accepts batched events from SDK
  - Body: `{ events: XRayEvent[] }`

### Query

- **GET /xray/runs** - List runs
  - Query params: `pipelineName`, `status`, `startDate`, `endDate`, `limit`, `offset`
  
- **GET /xray/runs/:runId** - Get a specific run with all steps

- **GET /xray/runs/:runId/steps/:stepId** - Get full details for a step

- **POST /xray/query/steps** - Advanced cross-pipeline queries
  ```json
  {
    "filters": [
      { "field": "stepType", "op": "eq", "value": "filter" },
      { "field": "metrics.dropRate", "op": "gt", "value": 0.9 }
    ],
    "include": ["run", "step"],
    "limit": 100
  }
  ```

## Approach

### Design Principles

1. **Pipeline-agnostic**: Works with any multi-step process.
2. **Fail-safe**: SDK never breaks your pipeline, even if backend is unavailable
3. **Queryable**: Cross-pipeline queries enabled by conventions (stepType, metrics)
4. **Performance-conscious**: Sampling and summarization to handle large candidate sets

### Key Features

- **Event batching**: SDK batches events and sends them asynchronously
- **Sampling**: Configurable per-step sampling for large datasets
- **Fail-open**: Pipeline continues normally if X-Ray backend is down
- **JSONB storage**: Flexible metadata and metrics storage in PostgreSQL

## Known Limitations

1. **JSONB query limitations**: Complex nested queries on metrics require careful indexing
2. **No UI**: API-only, no visual dashboard (see "What Next" in ARCHITECTURE.md)
3. **Single language**: SDK is TypeScript/JavaScript only
4. **No streaming**: Events are batched, not streamed in real-time
5. **No authentication**: Authentication should be added for production

## Future Improvements

See ARCHITECTURE.md "What Next?" section for planned enhancements:
- Multi-language SDKs
- Advanced querying and anomaly detection
- Performance optimizations (read replicas, materialized views)


