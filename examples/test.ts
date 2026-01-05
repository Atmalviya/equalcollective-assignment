import { XRayClient } from '../sdk/dist';

async function test() {
  console.log('Starting X-Ray test...\n');

  const xray = new XRayClient({
    baseUrl: process.env.XRAY_BASE_URL || 'http://localhost:3000',
    defaultMetadata: {
      test: true,
      timestamp: new Date().toISOString(),
    },
  });

  const run = xray.startRun({
    pipelineName: 'test_pipeline',
    metadata: {
      testId: 'simple_test',
    },
  });

  try {
    const result = await run.execute(async () => {
      console.log('Step 1: Processing input...');
      const step1 = await run.step('process_input', 'other', async (ctx) => {
        const input = 'Hello World';
        ctx.record({
          input: { message: input },
          output: { processed: input.toUpperCase() },
          metrics: { length: input.length },
        });
        return input.toUpperCase();
      });

      console.log('Step 2: Transforming data...');
      const step2 = await run.step('transform', 'other', async (ctx) => {
        const transformed = ctx.input.split('').reverse().join('');
        ctx.record({
          input: { data: ctx.input },
          output: { result: transformed },
          reasoning: 'Reversed the string',
        });
        return transformed;
      }, { input: step1 });

      console.log('Step 3: Finalizing...');
      const step3 = await run.step('finalize', 'selection', async (ctx) => {
        ctx.record({
          output: { final: ctx.input },
          metrics: { finalLength: ctx.input.length },
        });
        return ctx.input;
      }, { input: step2 });

      return step3;
    });

    console.log('\nTest completed successfully!');
    console.log('Result:', result);
    console.log('\nRun ID:', run.getRunId());
    console.log('\nTo view this run, query:');
    console.log(`curl http://localhost:3000/xray/runs/${run.getRunId()}`);

    // Flush any pending events
    await xray.flush();
    console.log('\nEvents flushed to API');
  } catch (error) {
    console.error('\nTest failed:', error);
    throw error;
  }
}

test().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

