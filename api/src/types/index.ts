export interface XRayEvent {
    type: 'run_started' | 'run_ended' | 'step_started' | 'step_ended';
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