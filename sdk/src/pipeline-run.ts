import { EventQueue, XRayEvent } from './event-queue';
import {
  StepType,
  StepStatus,
  RunStatus,
  StepContext,
  StepRecordData,
  StepOptions,
  StepCaptureConfig,
} from './types';

export class PipelineRun {
  private runId: string;
  private pipelineName: string;
  private metadata: Record<string, any>;
  private eventQueue: EventQueue;
  private stepCounter = 0;
  private startedAt: Date;

  constructor(
    runId: string,
    pipelineName: string,
    metadata: Record<string, any>,
    eventQueue: EventQueue
  ) {
    this.runId = runId;
    this.pipelineName = pipelineName;
    this.metadata = metadata;
    this.eventQueue = eventQueue;
    this.startedAt = new Date();

    this.eventQueue.enqueue({
      type: 'run_started',
      timestamp: this.startedAt.toISOString(),
      run: {
        id: this.runId,
        pipelineName: this.pipelineName,
        metadata: this.metadata,
        status: 'running',
      },
    });
  }

  async step<T>(
    stepName: string,
    stepType: StepType,
    fn: (ctx: StepContext) => Promise<T> | T,
    options?: StepOptions
  ): Promise<T> {
    const stepId = `${this.runId}_step_${++this.stepCounter}`;
    const stepOrder = this.stepCounter;
    const stepStartedAt = new Date();
    const input = options?.input;

    this.eventQueue.enqueue({
      type: 'step_started',
      timestamp: stepStartedAt.toISOString(),
      step: {
        id: stepId,
        runId: this.runId,
        stepName,
        stepType,
        order: stepOrder,
      },
    });

    const stepData: StepRecordData = {
      input: this.processInput(input, options?.capture),
      metrics: {},
    };

    const ctx: StepContext = {
      input: input || {},
      record: (data: StepRecordData) => {
        Object.assign(stepData, data);
      },
    };

    let status: StepStatus = 'success';
    let output: T;
    let error: any;

    try {
      output = await fn(ctx);
      stepData.output = this.processOutput(output, options?.capture);
    } catch (err) {
      status = 'failed';
      error = err;
      stepData.output = { error: String(err) };
      throw err;
    } finally {
      const stepEndedAt = new Date();
      const duration = stepEndedAt.getTime() - stepStartedAt.getTime();

      if (stepData.candidates && options?.capture?.candidates) {
        stepData.candidates = this.processCandidates(
          stepData.candidates,
          options.capture.candidates
        );
      }

      const stepEvent: XRayEvent = {
        type: 'step_ended',
        timestamp: stepEndedAt.toISOString(),
        step: {
          id: stepId,
          runId: this.runId,
          stepName,
          stepType,
          order: stepOrder,
          status,
          metrics: {
            ...stepData.metrics,
            durationMs: duration,
          },
          details: {
            input: stepData.input,
            output: stepData.output,
            reasoning: stepData.reasoning,
            filtersApplied: stepData.filtersApplied,
            candidatesSample: stepData.candidatesSample,
            candidatesStats: stepData.candidatesStats,
          },
        },
      };

      this.eventQueue.enqueue(stepEvent);
    }

    return output!;
  }

  end(status: RunStatus = 'success'): void {
    const endedAt = new Date();
    const duration = endedAt.getTime() - this.startedAt.getTime();

    this.eventQueue.enqueue({
      type: 'run_ended',
      timestamp: endedAt.toISOString(),
      run: {
        id: this.runId,
        pipelineName: this.pipelineName,
        metadata: this.metadata,
        status,
      },
    });
  }

  async execute<T>(fn: () => Promise<T> | T): Promise<T> {
    try {
      const result = await fn();
      this.end('success');
      return result;
    } catch (error) {
      this.end('failed');
      throw error;
    }
  }

  getRunId(): string {
    return this.runId;
  }

  private processInput(input: any, capture?: StepCaptureConfig): any {
    if (!input) return undefined;
    if (capture?.input === 'summary') {
      return this.summarize(input);
    }
    return input;
  }

  private processOutput(output: any, capture?: StepCaptureConfig): any {
    if (!output) return undefined;
    if (capture?.output === 'summary') {
      return this.summarize(output);
    }
    return output;
  }

  private processCandidates(
    candidates: any[],
    config: StepCaptureConfig['candidates']
  ): any[] {
    if (!candidates || !Array.isArray(candidates)) {
      return candidates;
    }

    if (!config || config.mode === 'full') {
      return candidates;
    }

    if (config.mode === 'summary') {
      return [];
    }

    if (config.mode === 'sample') {
      const max = config.max ?? 100;
      if (candidates.length <= max) {
        return candidates;
      }

      if (config.strategy === 'top') {
        return candidates.slice(0, max);
      } else if (config.strategy === 'random') {
        const sampled: any[] = [];
        const indices = new Set<number>();
        while (sampled.length < max && indices.size < candidates.length) {
          const idx = Math.floor(Math.random() * candidates.length);
          if (!indices.has(idx)) {
            indices.add(idx);
            sampled.push(candidates[idx]);
          }
        }
        return sampled;
      } else {
        return candidates.slice(0, max);
      }
    }

    return candidates;
  }

  private summarize(obj: any): any {
    if (Array.isArray(obj)) {
      return {
        _type: 'array',
        length: obj.length,
        sample: obj.slice(0, 3),
      };
    }
    if (typeof obj === 'object' && obj !== null) {
      const keys = Object.keys(obj);
      return {
        _type: 'object',
        keys,
        sample: keys.slice(0, 5).reduce((acc, key) => {
          acc[key] = obj[key];
          return acc;
        }, {} as any),
      };
    }
    return obj;
  }
}

