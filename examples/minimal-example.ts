/**
 * Minimal Example: Quick instrumentation in <30 minutes
 * 
 * This shows the absolute minimum code needed to get value from X-Ray
 */

import { XRayClient } from '../sdk/dist';

async function simplePipeline(input: string) {
  const xray = new XRayClient({
    baseUrl: process.env.XRAY_BASE_URL || 'http://localhost:3000',
  });

  const run = xray.startRun({
    pipelineName: 'simple_pipeline',
    metadata: { inputId: '123' },
  });

  return run.execute(async () => {
    // Step 1: Process input
    const step1 = await run.step('process', 'other', async () => {
      return input.toUpperCase();
    });

    // Step 2: Transform
    const step2 = await run.step('transform', 'other', async () => {
      return step1.split('').reverse().join('');
    });

    return step2;
  });
}

// Usage
simplePipeline('hello world').then(result => {
  console.log('Result:', result);
});

