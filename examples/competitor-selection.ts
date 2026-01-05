import { XRayClient } from '../sdk/dist';

async function generateKeywords(product: any): Promise<string[]> {
  await new Promise(resolve => setTimeout(resolve, 100));
  return ['phone case', 'mobile accessory', 'protective case'];
}

async function retrieveCandidates(keywords: string[]): Promise<any[]> {
  await new Promise(resolve => setTimeout(resolve, 200));
  return Array.from({ length: 5000 }, (_, i) => ({
    id: `candidate_${i}`,
    title: `Product ${i}`,
    price: 10 + Math.random() * 90,
    rating: 3 + Math.random() * 2,
    category: i % 2 === 0 ? 'Phone Accessories' : 'Laptop Accessories',
  }));
}

function filterCandidates(candidates: any[], product: any): any[] {
  let filtered = candidates;

  filtered = filtered.filter(c => c.price >= product.minPrice && c.price <= product.maxPrice);

  filtered = filtered.filter(c => c.rating >= 4.0);

  filtered = filtered.filter(c => 
    c.category === 'Phone Accessories' || c.category === 'Laptop Accessories'
  );

  return filtered;
}

async function rankCandidates(candidates: any[], product: any): Promise<any[]> {
  await new Promise(resolve => setTimeout(resolve, 300));
  
  return candidates.sort((a, b) => b.rating - a.rating);
}

async function competitorSelection(product: any) {
  const xray = new XRayClient({
    baseUrl: process.env.XRAY_BASE_URL || 'http://localhost:3000',
    defaultMetadata: {
      service: 'competitor-service',
      env: 'development',
    },
  });

  const run = xray.startRun({
    pipelineName: 'competitor_selection',
    metadata: {
      productId: product.id,
      productTitle: product.title,
    },
  });

  try {
    const keywords = await run.step('generate_keywords', 'llm', async (ctx) => {
      const result = await generateKeywords(product);
      ctx.record({
        input: { productTitle: product.title, category: product.category },
        output: { keywords: result },
        reasoning: 'Generated keywords from product title and category using LLM',
      });
      return result;
    }, {
      input: { product },
    });

    const candidates = await run.step('retrieve_candidates', 'retrieval', async (ctx) => {
      const result = await retrieveCandidates(keywords);
      ctx.record({
        output: { count: result.length },
        metrics: {
          candidateCount: result.length,
        },
      });
      return result;
    }, {
      input: { keywords },
    });

    const filtered = await run.step('filter_candidates', 'filter', async (ctx) => {
      const beforeCount = ctx.input.candidates.length;
      const result = filterCandidates(ctx.input.candidates, ctx.input.product);

      const dropRate = 1 - result.length / beforeCount;

      ctx.record({
        input: { candidateCount: beforeCount },
        output: { candidateCount: result.length },
        metrics: {
          candidateCountBefore: beforeCount,
          candidateCountAfter: result.length,
          dropRate: dropRate,
        },
        filtersApplied: [
          {
            name: 'price_range',
            params: { min: product.minPrice, max: product.maxPrice },
            beforeCount: beforeCount,
            afterCount: result.length,
            dropRate: dropRate,
          },
        ],
        candidatesSample: result.slice(0, 10),
        candidatesStats: {
          priceRange: {
            min: Math.min(...result.map(c => c.price)),
            max: Math.max(...result.map(c => c.price)),
          },
          categoryDistribution: result.reduce((acc, c) => {
            acc[c.category] = (acc[c.category] || 0) + 1;
            return acc;
          }, {} as Record<string, number>),
        },
      });

      return result;
    }, {
      input: { candidates, product },
      capture: {
        candidates: {
          mode: 'sample',
          max: 10,
          strategy: 'top',
        },
      },
    });

    const ranked = await run.step('rank_candidates', 'ranking', async (ctx) => {
      const result = await rankCandidates(ctx.input.candidates, ctx.input.product);
      ctx.record({
        input: { candidateCount: ctx.input.candidates.length },
        output: {
          topCandidates: result.slice(0, 5).map(c => ({
            id: c.id,
            title: c.title,
            rating: c.rating,
          })),
        },
        reasoning: 'Ranked by rating (descending)',
        metrics: {
          candidateCount: result.length,
        },
      });
      return result;
    }, {
      input: { candidates: filtered, product },
    });

    const best = await run.step('select_best', 'selection', async (ctx) => {
      const result = ctx.input.candidates[0];
      ctx.record({
        input: { candidateCount: ctx.input.candidates.length },
        output: {
          selectedId: result.id,
          selectedTitle: result.title,
          selectedRating: result.rating,
        },
        reasoning: 'Selected top-ranked candidate',
      });
      return result;
    }, {
      input: { candidates: ranked },
    });

    run.end('success');

    return best;
  } catch (error) {
    run.end('failed');
    throw error;
  }
}

async function main() {
  const product = {
    id: 'product_123',
    title: 'iPhone 15 Pro Max Case',
    category: 'Phone Accessories',
    minPrice: 15,
    maxPrice: 50,
  };

  try {
    const competitor = await competitorSelection(product);
    console.log('Selected competitor:', competitor);
    console.log('\nTo debug this run, query:');
    console.log(`GET /xray/runs?pipelineName=competitor_selection&metadata.productId=${product.id}`);
  } catch (error) {
    console.error('Error:', error);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

export { competitorSelection };

