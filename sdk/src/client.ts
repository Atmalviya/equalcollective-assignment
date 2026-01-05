import { EventQueue } from './event-queue';
import { PipelineRun } from './pipeline-run';
import { XRayConfig, RunOptions } from './types';
import { v4 as uuidv4 } from 'uuid';

export class XRayClient {
  private config: XRayConfig;
  private eventQueue: EventQueue;

  constructor(config: XRayConfig) {
    if (!config.baseUrl) {
      throw new Error('XRayClient requires a baseUrl');
    }

    this.config = {
      failOpen: true,
      batchSize: 50,
      flushInterval: 5000,
      maxQueueSize: 10000,
      ...config,
    };

    this.eventQueue = new EventQueue(this.config);
  }

  startRun(options: RunOptions): PipelineRun {
    const runId = `run_${uuidv4()}`;
    const metadata = {
      ...this.config.defaultMetadata,
      ...options.metadata,
    };

    return new PipelineRun(
      runId,
      options.pipelineName,
      metadata,
      this.eventQueue
    );
  }

  async flush(): Promise<void> {
    await this.eventQueue.flushAndClose();
  }
}

