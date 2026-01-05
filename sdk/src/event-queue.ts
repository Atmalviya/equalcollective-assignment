import { XRayConfig } from './types';

export type EventType = 'run_started' | 'run_ended' | 'step_started' | 'step_ended';

export interface XRayEvent {
  type: EventType;
  timestamp: string;
  run?: {
    id: string;
    pipelineName: string;
    metadata?: Record<string, any>;
    status?: string;
  };
  step?: {
    id: string;
    runId: string;
    stepName: string;
    stepType: string;
    order: number;
    status?: string;
    metrics?: Record<string, any>;
    details?: {
      input?: any;
      output?: any;
      reasoning?: string | any;
      filtersApplied?: any[];
      candidatesSample?: any[];
      candidatesStats?: any;
    };
  };
}

export class EventQueue {
  private queue: XRayEvent[] = [];
  private config: Required<Pick<XRayConfig, 'baseUrl' | 'batchSize' | 'flushInterval' | 'failOpen' | 'maxQueueSize'>>;
  private flushTimer?: NodeJS.Timeout;
  private isFlushing = false;
  private consecutiveFailures = 0;
  private readonly maxFailures = 5;

  constructor(config: XRayConfig) {
    this.config = {
      baseUrl: config.baseUrl,
      batchSize: config.batchSize ?? 50,
      flushInterval: config.flushInterval ?? 5000,
      failOpen: config.failOpen ?? true,
      maxQueueSize: config.maxQueueSize ?? 10000,
    };

    this.startFlushTimer();
  }

  enqueue(event: XRayEvent): void {
    if (this.queue.length >= this.config.maxQueueSize) {
      if (!this.config.failOpen) {
        throw new Error('X-Ray event queue is full');
      }
      this.queue.shift();
    }

    this.queue.push(event);

    if (this.queue.length >= this.config.batchSize) {
      this.flush();
    }
  }

  private startFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    this.flushTimer = setInterval(() => {
      if (this.queue.length > 0) {
        this.flush();
      }
    }, this.config.flushInterval);
  }

  async flush(): Promise<void> {
    if (this.isFlushing || this.queue.length === 0) {
      return;
    }

    this.isFlushing = true;
    const batch = this.queue.splice(0, this.config.batchSize);

    try {
      await this.sendBatch(batch);
      this.consecutiveFailures = 0;
    } catch (error) {
      this.consecutiveFailures++;
      
      if (this.consecutiveFailures >= this.maxFailures && this.config.failOpen) {
        console.warn('[X-Ray] Backend unavailable, dropping events. Pipeline continues normally.');
        this.queue = [];
      } else {
        this.queue.unshift(...batch);
      }
    } finally {
      this.isFlushing = false;
    }
  }

  private async sendBatch(events: XRayEvent[]): Promise<void> {
    const url = `${this.config.baseUrl}/xray/events`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ events }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(`X-Ray API error: ${response.status} ${response.statusText}`);
    }
  }

  async flushAndClose(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    await this.flush();
  }
}

