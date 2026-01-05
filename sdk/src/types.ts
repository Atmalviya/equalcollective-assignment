export type StepType = 'llm' | 'filter' | 'retrieval' | 'ranking' | 'selection' | 'other';

export type RunStatus = 'running' | 'success' | 'failed' | 'partial';

export type StepStatus = 'success' | 'failed' | 'skipped';

export interface XRayConfig {
  baseUrl: string;
  defaultMetadata?: Record<string, any>;
  batchSize?: number;
  flushInterval?: number;
  failOpen?: boolean;
  maxQueueSize?: number;
}

export interface RunMetadata {
  [key: string]: any;
}

export interface StepMetrics {
  [key: string]: number | string | boolean;
}

export interface FilterApplied {
  name: string;
  type?: string;
  params?: Record<string, any>;
  beforeCount?: number;
  afterCount?: number;
  dropRate?: number;
  reason?: string;
}

export interface StepCaptureConfig {
  candidates?: {
    mode: 'full' | 'sample' | 'summary';
    max?: number;
    strategy?: 'top' | 'random' | 'first';
  };
  rejectionReasons?: 'full' | 'summary-only' | 'none';
  input?: 'full' | 'summary';
  output?: 'full' | 'summary';
}

export interface StepContext {
  input: any;
  record: (data: StepRecordData) => void;
}

export interface StepRecordData {
  input?: any;
  output?: any;
  reasoning?: string | Record<string, any>;
  filtersApplied?: FilterApplied[];
  candidates?: any[];
  candidatesSample?: any[];
  candidatesStats?: Record<string, any>;
  metrics?: StepMetrics;
}

export interface StepOptions {
  input?: any;
  capture?: StepCaptureConfig;
}

export interface RunOptions {
  pipelineName: string;
  metadata?: RunMetadata;
}

