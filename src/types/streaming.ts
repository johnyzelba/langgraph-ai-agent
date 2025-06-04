export interface ProgressEvent {
  type: 'progress' | 'error' | 'done' | 'content';
  data: {
    operation: string;
    currentState?: string;
    percentage?: number;
    message: string;
    timestamp: number;
    metadata?: Record<string, unknown>;
    content?: string; // For content streaming (LLM responses)
  };
}

export interface StreamingOperation<T> {
  operationName: string;
  execute(progressCallback: (event: ProgressEvent) => void): Promise<T>;
}

export type EventCallback = (event: ProgressEvent) => void;

// Helper function to create progress events
export function createProgressEvent(
  operation: string,
  message: string,
  options: {
    currentState?: string;
    percentage?: number;
    metadata?: Record<string, unknown>;
  } = {}
): ProgressEvent {
  return {
    type: 'progress',
    data: {
      operation,
      message,
      timestamp: Date.now(),
      ...options,
    },
  };
}

// Helper function to create error events
export function createErrorEvent(
  operation: string,
  message: string,
  metadata?: Record<string, unknown>
): ProgressEvent {
  return {
    type: 'error',
    data: {
      operation,
      message,
      timestamp: Date.now(),
      metadata,
    },
  };
}

// Helper function to create completion events
export function createCompletionEvent(
  operation: string,
  message: string,
  metadata?: Record<string, unknown>
): ProgressEvent {
  return {
    type: 'done',
    data: {
      operation,
      message,
      timestamp: Date.now(),
      metadata,
    },
  };
}

// Helper function to create content events (for LLM streaming)
export function createContentEvent(
  operation: string,
  content: string
): ProgressEvent {
  return {
    type: 'content',
    data: {
      operation,
      message: 'Content chunk',
      content,
      timestamp: Date.now(),
    },
  };
} 