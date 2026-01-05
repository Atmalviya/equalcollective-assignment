/**
 * Complex Pipeline Example: E-commerce Product Recommendation System
 * 
 * This demonstrates a realistic multi-step pipeline with:
 * - Multiple step types (LLM, retrieval, filter, ranking, selection)
 * - Large candidate sets (10,000+ items)
 * - Complex filtering and ranking logic
 * - Multiple decision points
 * - Error handling
 * - Detailed X-Ray instrumentation
 */

import { XRayClient } from '../sdk/dist';

// Types
interface Product {
  id: string;
  title: string;
  category: string;
  price: number;
  rating: number;
  reviewCount: number;
  brand: string;
  inStock: boolean;
  tags: string[];
  description: string;
}

interface User {
  id: string;
  preferences: {
    priceRange: [number, number];
    preferredBrands: string[];
    minRating: number;
  };
  purchaseHistory: string[];
}

interface RecommendationContext {
  user: User;
  currentProduct: Product;
  goal: 'similar' | 'complementary' | 'upgrade';
}

function generateMockProducts(count: number): Product[] {
  const categories = ['Electronics', 'Clothing', 'Home & Kitchen', 'Sports', 'Books'];
  const brands = ['BrandA', 'BrandB', 'BrandC', 'BrandD', 'BrandE'];
  const tags = ['premium', 'budget', 'eco-friendly', 'bestseller', 'new', 'sale'];

  return Array.from({ length: count }, (_, i) => ({
    id: `prod_${i}`,
    title: `Product ${i} - ${categories[i % categories.length]}`,
    category: categories[i % categories.length],
    price: Math.round((10 + Math.random() * 990) * 100) / 100,
    rating: 2 + Math.random() * 3,
    reviewCount: Math.floor(Math.random() * 10000),
    brand: brands[i % brands.length],
    inStock: Math.random() > 0.1,
    tags: tags.slice(0, Math.floor(Math.random() * 3) + 1),
    description: `Description for product ${i}`,
  }));
}

// Step 1: Analyze user intent using LLM
async function analyzeUserIntent(
  context: RecommendationContext
): Promise<{ keywords: string[]; intent: string; reasoning: string }> {

  await new Promise(resolve => setTimeout(resolve, 150));

  const { currentProduct, goal } = context;
  let keywords: string[];
  let intent: string;
  let reasoning: string;

  if (goal === 'similar') {
    keywords = [currentProduct.category, currentProduct.brand, ...currentProduct.tags];
    intent = 'Find products similar to current selection';
    reasoning = `User wants similar products in ${currentProduct.category} category, preferably from ${currentProduct.brand} brand`;
  } else if (goal === 'complementary') {
    keywords = ['complementary', currentProduct.category, 'accessories'];
    intent = 'Find complementary products';
    reasoning = `User wants products that complement ${currentProduct.title}`;
  } else {
    keywords = [currentProduct.category, 'premium', 'upgrade'];
    intent = 'Find upgrade options';
    reasoning = `User wants higher-end alternatives to ${currentProduct.title}`;
  }

  return { keywords, intent, reasoning };
}

// Step 2: Retrieve candidates from catalog
async function retrieveCandidates(keywords: string[], catalog: Product[]): Promise<Product[]> {
  await new Promise(resolve => setTimeout(resolve, 200));

  const matched = catalog.filter(product => {
    const searchText = `${product.title} ${product.category} ${product.tags.join(' ')}`.toLowerCase();
    return keywords.some(keyword => searchText.includes(keyword.toLowerCase()));
  });

  return matched;
}

// Step 3: Apply multiple filters
function applyFilters(
  candidates: Product[],
  user: User,
  context: RecommendationContext
): { filtered: Product[]; filterStats: Array<{ name: string; before: number; after: number; dropRate: number; reason?: string }> } {
  let current = candidates;
  const stats: Array<{ name: string; before: number; after: number; dropRate: number; reason?: string }> = [];

  // Filter 1: Price range
  const beforePrice = current.length;
  current = current.filter(p => {
    const [min, max] = user.preferences.priceRange;
    return p.price >= min && p.price <= max;
  });
  stats.push({
    name: 'price_range',
    before: beforePrice,
    after: current.length,
    dropRate: 1 - current.length / beforePrice,
    reason: `Filtered to price range $${user.preferences.priceRange[0]}-$${user.preferences.priceRange[1]}`,
  });

  // Filter 2: Rating threshold
  const beforeRating = current.length;
  current = current.filter(p => p.rating >= user.preferences.minRating);
  stats.push({
    name: 'rating_threshold',
    before: beforeRating,
    after: current.length,
    dropRate: 1 - current.length / beforeRating,
    reason: `Filtered to minimum rating ${user.preferences.minRating}`,
  });

  // Filter 3: Stock availability
  const beforeStock = current.length;
  current = current.filter(p => p.inStock);
  stats.push({
    name: 'stock_availability',
    before: beforeStock,
    after: current.length,
    dropRate: 1 - current.length / beforeStock,
    reason: 'Removed out-of-stock items',
  });

  // Filter 4: Exclude already purchased
  if (context.goal !== 'upgrade') {
    const beforePurchase = current.length;
    current = current.filter(p => !user.purchaseHistory.includes(p.id));
    stats.push({
      name: 'exclude_purchased',
      before: beforePurchase,
      after: current.length,
      dropRate: 1 - current.length / beforePurchase,
      reason: 'Excluded products user already purchased',
    });
  }

  // Filter 5: Category relevance
  if (context.goal === 'similar') {
    const beforeCategory = current.length;
    current = current.filter(p => p.category === context.currentProduct.category);
    stats.push({
      name: 'category_match',
      before: beforeCategory,
      after: current.length,
      dropRate: 1 - current.length / beforeCategory,
      reason: `Filtered to same category: ${context.currentProduct.category}`,
    });
  }

  return { filtered: current, filterStats: stats };
}

// Step 4: Score candidates using multiple signals
function scoreCandidates(
  candidates: Product[],
  user: User,
  context: RecommendationContext
): Array<Product & { score: number; scoreBreakdown: Record<string, number> }> {
  return candidates.map(product => {
    const breakdown: Record<string, number> = {};

    // Score 1: Rating (0-40 points)
    breakdown.rating = (product.rating / 5) * 40;

    // Score 2: Review count (0-20 points) - more reviews = more trusted
    breakdown.reviewCount = Math.min((product.reviewCount / 1000) * 20, 20);

    // Score 3: Brand preference (0-20 points)
    breakdown.brandPreference = user.preferences.preferredBrands.includes(product.brand) ? 20 : 0;

    // Score 4: Price proximity (0-20 points) - closer to user's preferred range
    const [minPrice, maxPrice] = user.preferences.priceRange;
    const midPrice = (minPrice + maxPrice) / 2;
    const priceDiff = Math.abs(product.price - midPrice);
    const priceRange = maxPrice - minPrice;
    breakdown.priceProximity = Math.max(0, 20 * (1 - priceDiff / priceRange));

    // Score 5: Tag relevance (bonus points)
    breakdown.tagBonus = product.tags.includes('bestseller') ? 5 : 0;
    breakdown.tagBonus += product.tags.includes('new') ? 3 : 0;

    const totalScore = Object.values(breakdown).reduce((sum, val) => sum + val, 0);

    return {
      ...product,
      score: totalScore,
      scoreBreakdown: breakdown,
    };
  });
}

// Step 5: LLM-based relevance ranking
async function rankByRelevance(
  scoredCandidates: Array<Product & { score: number }>,
  context: RecommendationContext
): Promise<Array<Product & { score: number; relevanceScore: number; llmReasoning: string }>> {
  await new Promise(resolve => setTimeout(resolve, 300));

  const topCandidates = scoredCandidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 50);

  return topCandidates.map((candidate, index) => {
    const relevanceScore = candidate.score + (50 - index) * 0.5; // Boost top candidates
    const llmReasoning = `Product ${candidate.id} is highly relevant because it matches ${context.currentProduct.category} category and has strong ratings (${candidate.rating}/5) with ${candidate.reviewCount} reviews.`;

    return {
      ...candidate,
      relevanceScore,
      llmReasoning,
    };
  });
}

// Step 6: Final selection with diversity
function selectDiverseRecommendations(
  ranked: Array<Product & { relevanceScore: number }>,
  count: number = 10
): Product[] {
  const selected: Product[] = [];
  const usedBrands = new Set<string>();
  const usedCategories = new Set<string>();

  for (const candidate of ranked) {
    if (selected.length >= count) break;

    const brandDiversity = !usedBrands.has(candidate.brand) ? 1.2 : 1.0;
    const categoryDiversity = !usedCategories.has(candidate.category) ? 1.1 : 1.0;
    const diversityScore = candidate.relevanceScore * brandDiversity * categoryDiversity;

    if (selected.length < count || Math.random() > 0.3) {
      selected.push(candidate);
      usedBrands.add(candidate.brand);
      usedCategories.add(candidate.category);
    }
  }

  return selected.slice(0, count);
}

// Main Pipeline
async function productRecommendationPipeline(
  context: RecommendationContext,
  catalog: Product[]
): Promise<Product[]> {
  const xray = new XRayClient({
    baseUrl: process.env.XRAY_BASE_URL || 'http://localhost:3000',
    defaultMetadata: {
      service: 'recommendation-service',
      env: 'production',
    },
  });

  const run = xray.startRun({
    pipelineName: 'product_recommendation',
    metadata: {
      userId: context.user.id,
      currentProductId: context.currentProduct.id,
      goal: context.goal,
    },
  });

  try {
    return await run.execute(async () => {
      // Step 1: Analyze user intent
      const intent = await run.step('analyze_intent', 'llm', async (ctx) => {
        const result = await analyzeUserIntent(context);
        ctx.record({
          input: {
            currentProduct: ctx.input.currentProduct.title,
            goal: ctx.input.goal,
            userPreferences: ctx.input.user.preferences,
          },
          output: {
            keywords: result.keywords,
            intent: result.intent,
          },
          reasoning: result.reasoning,
          metrics: {
            keywordCount: result.keywords.length,
          },
        });
        return result;
      }, {
        input: { currentProduct: context.currentProduct, goal: context.goal, user: context.user },
      });

      // Step 2: Retrieve candidates
      const candidates = await run.step('retrieve_candidates', 'retrieval', async (ctx) => {
        const result = await retrieveCandidates(ctx.input.keywords, ctx.input.catalog);
        ctx.record({
          input: {
            keywordCount: ctx.input.keywords.length,
            catalogSize: ctx.input.catalog.length,
          },
          output: {
            candidateCount: result.length,
          },
          metrics: {
            candidateCount: result.length,
            retrievalRate: result.length / ctx.input.catalog.length,
          },
          candidatesSample: result.slice(0, 5),
        });
        return result;
      }, {
        input: { keywords: intent.keywords, catalog },
        capture: {
          candidates: {
            mode: 'sample',
            max: 5,
            strategy: 'first',
          },
        },
      });

      // Step 3: Apply filters
      const { filtered, filterStats } = await run.step('apply_filters', 'filter', async (ctx) => {
        const result = applyFilters(ctx.input.candidates, ctx.input.user, ctx.input.context);
        ctx.record({
          input: {
            candidateCount: ctx.input.candidates.length,
          },
          output: {
            filteredCount: result.filtered.length,
          },
          filtersApplied: result.filterStats,
          metrics: {
            candidateCountBefore: ctx.input.candidates.length,
            candidateCountAfter: result.filtered.length,
            dropRate: 1 - result.filtered.length / ctx.input.candidates.length,
            filtersAppliedCount: result.filterStats.length,
          },
          candidatesSample: result.filtered.slice(0, 10),
          candidatesStats: {
            priceRange: {
              min: Math.min(...result.filtered.map(p => p.price)),
              max: Math.max(...result.filtered.map(p => p.price)),
              avg: result.filtered.reduce((sum, p) => sum + p.price, 0) / result.filtered.length,
            },
            ratingDistribution: {
              min: Math.min(...result.filtered.map(p => p.rating)),
              max: Math.max(...result.filtered.map(p => p.rating)),
              avg: result.filtered.reduce((sum, p) => sum + p.rating, 0) / result.filtered.length,
            },
            categoryBreakdown: result.filtered.reduce((acc, p) => {
              acc[p.category] = (acc[p.category] || 0) + 1;
              return acc;
            }, {} as Record<string, number>),
          },
        });
        return result;
      }, {
        input: { candidates, user: context.user, context },
        capture: {
          candidates: {
            mode: 'sample',
            max: 10,
            strategy: 'top',
          },
        },
      });

      // Step 4: Score candidates
      const scored = await run.step('score_candidates', 'ranking', async (ctx) => {
        const result = scoreCandidates(ctx.input.candidates, ctx.input.user, ctx.input.context);
        ctx.record({
          input: {
            candidateCount: ctx.input.candidates.length,
          },
          output: {
            scoredCount: result.length,
            topScore: Math.max(...result.map(r => r.score)),
            avgScore: result.reduce((sum, r) => sum + r.score, 0) / result.length,
          },
          metrics: {
            candidateCount: result.length,
          },
          candidatesSample: result
            .sort((a, b) => b.score - a.score)
            .slice(0, 5)
            .map(c => ({
              id: c.id,
              title: c.title,
              score: c.score,
              scoreBreakdown: c.scoreBreakdown,
            })),
        });
        return result;
      }, {
        input: { candidates: filtered, user: context.user, context },
      });

      // Step 5: LLM relevance ranking
      const ranked = await run.step('rank_by_relevance', 'llm', async (ctx) => {
        const result = await rankByRelevance(ctx.input.candidates, ctx.input.context);
        ctx.record({
          input: {
            candidateCount: ctx.input.candidates.length,
          },
          output: {
            rankedCount: result.length,
            topRelevanceScore: Math.max(...result.map(r => r.relevanceScore)),
          },
          reasoning: result[0]?.llmReasoning || 'No candidates to rank',
          metrics: {
            candidateCount: result.length,
          },
          candidatesSample: result.slice(0, 5).map(c => ({
            id: c.id,
            title: c.title,
            relevanceScore: c.relevanceScore,
            llmReasoning: c.llmReasoning,
          })),
        });
        return result;
      }, {
        input: { candidates: scored, context },
      });

      // Step 6: Select diverse recommendations
      const final = await run.step('select_diverse', 'selection', async (ctx) => {
        const result = selectDiverseRecommendations(ctx.input.candidates, 10);
        ctx.record({
          input: {
            candidateCount: ctx.input.candidates.length,
          },
          output: {
            selectedCount: result.length,
            selectedIds: result.map(p => p.id),
          },
          reasoning: `Selected ${result.length} diverse recommendations considering brand and category diversity`,
          metrics: {
            inputCount: ctx.input.candidates.length,
            outputCount: result.length,
            selectionRate: result.length / ctx.input.candidates.length,
          },
          candidatesSample: result.map(p => ({
            id: p.id,
            title: p.title,
            brand: p.brand,
            category: p.category,
            price: p.price,
            rating: p.rating,
          })),
        });
        return result;
      }, {
        input: { candidates: ranked },
      });

      return final;
    });
  } catch (error) {
    console.error('Pipeline failed:', error);
    throw error;
  } finally {
    // Ensure events are flushed
    await xray.flush();
  }
}

async function main() {
  console.log('Starting Complex Pipeline Test\n');

  const catalog = generateMockProducts(10000);
  console.log(`Generated catalog with ${catalog.length} products\n`);

  // Create test context
  const currentProduct: Product = {
    id: 'prod_current',
    title: 'iPhone 15 Pro Max',
    category: 'Electronics',
    price: 999.99,
    rating: 4.5,
    reviewCount: 5000,
    brand: 'BrandA',
    inStock: true,
    tags: ['premium', 'bestseller'],
    description: 'Latest iPhone model',
  };

  const user: User = {
    id: 'user_123',
    preferences: {
      priceRange: [50, 500],
      preferredBrands: ['BrandA', 'BrandB'],
      minRating: 3.5,
    },
    purchaseHistory: ['prod_100', 'prod_200'],
  };

  const context: RecommendationContext = {
    user,
    currentProduct,
    goal: 'similar',
  };

  try {
    console.log('Running recommendation pipeline...');
    console.log(`   Goal: ${context.goal}`);
    console.log(`   Current Product: ${currentProduct.title}`);
    console.log(`   User: ${user.id}\n`);

    const startTime = Date.now();
    const recommendations = await productRecommendationPipeline(context, catalog);
    const duration = Date.now() - startTime;

    console.log('\nPipeline completed successfully!\n');
    console.log(`Duration: ${duration}ms\n`);
    console.log(`Recommendations (${recommendations.length} products):\n`);

    recommendations.forEach((rec, index) => {
      console.log(`  ${index + 1}. ${rec.title}`);
      console.log(`     Brand: ${rec.brand} | Price: $${rec.price.toFixed(2)} | Rating: ${rec.rating.toFixed(1)}/5`);
    });

    console.log('\nTo view this run in X-Ray:');
    console.log('   1. Query API: curl http://localhost:3000/xray/runs -H "Authorization: Bearer demo-key" | jq');
    console.log('   2. Or use Prisma Studio: cd api && npx prisma studio');
    console.log('\nTry querying for filter steps with high drop rates:');
    console.log('   POST /xray/query/steps with filters: stepType=filter, metrics.dropRate>0.9\n');
  } catch (error) {
    console.error('\nPipeline failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

export { productRecommendationPipeline, RecommendationContext };

