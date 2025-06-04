# Streaming Progress Updates - Client Implementation Guide

## Overview

The AI agent now supports real-time progress updates for all long-running operations using Server-Sent Events (SSE). This includes:

- Chart generation with state-by-state progress
- Tool execution with per-tool progress  
- LLM response generation with content streaming
- Error handling and completion events

## Event Types

### Progress Event
```typescript
interface ProgressEvent {
  type: 'progress';
  data: {
    operation: string;           // e.g., 'chart_generation', 'tool_execution'
    currentState?: string;       // Current operation state
    percentage?: number;         // Progress percentage (0-100)
    message: string;            // Human-readable progress message
    timestamp: number;          // Unix timestamp
    metadata?: Record<string, unknown>; // Additional context
  };
}
```

### Content Event (for LLM streaming)
```typescript
interface ContentEvent {
  type: 'content';
  data: {
    operation: string;
    message: string;
    content: string;            // Text chunk from LLM
    timestamp: number;
  };
}
```

### Completion Event
```typescript
interface CompletionEvent {
  type: 'done';
  data: {
    operation: string;
    message: string;
    timestamp: number;
    metadata?: Record<string, unknown>;
  };
}
```

### Error Event
```typescript
interface ErrorEvent {
  type: 'error';
  data: {
    operation: string;
    message: string;
    timestamp: number;
    metadata?: Record<string, unknown>;
  };
}
```

## Client Implementation Examples

### JavaScript/TypeScript (Browser)

```javascript
// Set up the EventSource for streaming
const eventSource = new EventSource('/api/agent/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer your-token-here'
  },
  body: JSON.stringify({
    message: 'Create a sales chart for Q4 2024',
    stream: true
  })
});

// Progress tracking
let currentProgress = 0;
let currentOperation = '';
let responseContent = '';

eventSource.onmessage = (event) => {
  try {
    const data = JSON.parse(event.data);
    
    switch (data.type) {
      case 'progress':
        handleProgress(data.data);
        break;
        
      case 'content':
        handleContent(data.data);
        break;
        
      case 'done':
        handleCompletion(data.data);
        eventSource.close();
        break;
        
      case 'error':
        handleError(data.data);
        eventSource.close();
        break;
        
      default:
        console.log('Unknown event type:', data.type);
    }
  } catch (error) {
    console.error('Failed to parse SSE data:', error);
  }
};

function handleProgress(progressData) {
  currentOperation = progressData.operation;
  currentProgress = progressData.percentage || 0;
  
  // Update UI progress bar
  updateProgressBar(currentProgress, progressData.message);
  
  // Log detailed progress for chart generation
  if (progressData.operation === 'chart_generation') {
    console.log(`Chart Generation - ${progressData.currentState}: ${progressData.message}`);
    
    // Update specific UI elements based on state
    switch (progressData.currentState) {
      case 'planning':
        showStatus('Planning chart structure...');
        break;
      case 'understanding_schema':
        showStatus('Analyzing database schema...');
        break;
      case 'generating_query':
        showStatus('Generating SQL query...');
        break;
      case 'executing_query':
        showStatus('Executing database query...');
        break;
      case 'validating_results':
        showStatus('Validating query results...');
        break;
      case 'transforming_data':
        showStatus('Transforming data for chart...');
        break;
    }
  }
  
  // Handle tool execution progress
  if (progressData.operation === 'tool_execution') {
    const { currentTool, toolIndex, totalTools } = progressData.metadata || {};
    if (currentTool) {
      showStatus(`Executing tool ${toolIndex}/${totalTools}: ${currentTool}`);
    }
  }
}

function handleContent(contentData) {
  // Append LLM content chunks as they arrive
  responseContent += contentData.content;
  updateResponseDisplay(responseContent);
}

function handleCompletion(completionData) {
  console.log('Operation completed:', completionData);
  showStatus('Completed successfully!');
  hideProgressBar();
  
  // Handle final response based on operation type
  if (completionData.operation === 'chart_generation') {
    // Chart data will be in the final response
    displayChart();
  }
}

function handleError(errorData) {
  console.error('Operation failed:', errorData);
  showError(`${errorData.operation} failed: ${errorData.message}`);
  hideProgressBar();
}

// UI Helper Functions
function updateProgressBar(percentage, message) {
  const progressBar = document.getElementById('progress-bar');
  const statusText = document.getElementById('status-text');
  
  if (progressBar) {
    progressBar.style.width = `${percentage}%`;
    progressBar.setAttribute('aria-valuenow', percentage.toString());
  }
  
  if (statusText) {
    statusText.textContent = message;
  }
}

function showStatus(message) {
  const statusElement = document.getElementById('operation-status');
  if (statusElement) {
    statusElement.textContent = message;
    statusElement.className = 'status-info';
  }
}

function showError(message) {
  const statusElement = document.getElementById('operation-status');
  if (statusElement) {
    statusElement.textContent = message;
    statusElement.className = 'status-error';
  }
}

function hideProgressBar() {
  const progressContainer = document.getElementById('progress-container');
  if (progressContainer) {
    progressContainer.style.display = 'none';
  }
}

function updateResponseDisplay(content) {
  const responseElement = document.getElementById('response-content');
  if (responseElement) {
    responseElement.textContent = content;
  }
}

function displayChart() {
  // Chart data handling will depend on your chart library (e.g., Nivo, Chart.js)
  console.log('Displaying chart with received data');
}
```

### React Hook Example

```typescript
import { useState, useEffect, useCallback } from 'react';

interface StreamingState {
  isStreaming: boolean;
  progress: number;
  currentOperation: string;
  currentMessage: string;
  content: string;
  error: string | null;
  completed: boolean;
}

export function useStreamingAgent() {
  const [state, setState] = useState<StreamingState>({
    isStreaming: false,
    progress: 0,
    currentOperation: '',
    currentMessage: '',
    content: '',
    error: null,
    completed: false,
  });

  const sendStreamingRequest = useCallback(async (message: string) => {
    setState(prev => ({
      ...prev,
      isStreaming: true,
      progress: 0,
      content: '',
      error: null,
      completed: false,
    }));

    try {
      const response = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAuthToken()}`,
        },
        body: JSON.stringify({
          message,
          stream: true,
        }),
      });

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const eventData = JSON.parse(line.slice(6));
              
              switch (eventData.type) {
                case 'progress':
                  setState(prev => ({
                    ...prev,
                    progress: eventData.data.percentage || prev.progress,
                    currentOperation: eventData.data.operation,
                    currentMessage: eventData.data.message,
                  }));
                  break;

                case 'content':
                  setState(prev => ({
                    ...prev,
                    content: prev.content + eventData.data.content,
                  }));
                  break;

                case 'done':
                  setState(prev => ({
                    ...prev,
                    isStreaming: false,
                    completed: true,
                    progress: 100,
                  }));
                  return;

                case 'error':
                  setState(prev => ({
                    ...prev,
                    isStreaming: false,
                    error: eventData.data.message,
                  }));
                  return;
              }
            } catch (parseError) {
              console.error('Failed to parse SSE event:', parseError);
            }
          }
        }
      }
    } catch (error) {
      setState(prev => ({
        ...prev,
        isStreaming: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }));
    }
  }, []);

  return {
    ...state,
    sendStreamingRequest,
  };
}

// Usage in a React component
function ChatInterface() {
  const {
    isStreaming,
    progress,
    currentOperation,
    currentMessage,
    content,
    error,
    completed,
    sendStreamingRequest,
  } = useStreamingAgent();

  const handleSubmit = (message: string) => {
    sendStreamingRequest(message);
  };

  return (
    <div>
      {isStreaming && (
        <div className="progress-container">
          <div className="progress-bar">
            <div 
              className="progress-fill" 
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="progress-text">
            {currentOperation}: {currentMessage}
          </div>
        </div>
      )}
      
      {content && (
        <div className="response-content">
          {content}
        </div>
      )}
      
      {error && (
        <div className="error-message">
          Error: {error}
        </div>
      )}
      
      {completed && (
        <div className="completion-message">
          Operation completed successfully!
        </div>
      )}
    </div>
  );
}
```

## Operation-Specific Progress States

### Chart Generation States
- `planning` (10%) - Analyzing request and planning chart structure
- `understanding_schema` (20%) - Retrieving and analyzing database schema
- `generating_query` (30%) - Creating SQL query
- `executing_query` (50%) - Running database query
- `validating_results` (70%) - Validating query results
- `transforming_data` (90%) - Converting data to chart format
- `completed` (100%) - Chart ready

### Tool Execution States
- `executing_<tool_name>` - Currently executing specific tool
- `completed_<tool_name>` - Tool completed successfully
- `error_<tool_name>` - Tool execution failed
- `failed_<tool_name>` - Tool failed with error

### LLM Generation States
- Content chunks are streamed in real-time
- Progress percentage estimated based on response length
- Periodic progress updates every 10 chunks

## Error Handling

Always implement proper error handling for:
- Network connection failures
- SSE parsing errors
- Operation-specific errors
- Timeout scenarios

```javascript
eventSource.onerror = (error) => {
  console.error('SSE connection error:', error);
  // Implement retry logic or fallback to non-streaming mode
};

// Implement timeout for long-running operations
const timeout = setTimeout(() => {
  eventSource.close();
  handleError({ message: 'Operation timed out' });
}, 300000); // 5 minutes

// Clear timeout on completion
eventSource.addEventListener('done', () => {
  clearTimeout(timeout);
});
```

## Best Practices

1. **Always handle all event types** - Don't assume only certain events will be sent
2. **Implement proper error handling** - Network issues and parsing errors can occur
3. **Provide visual feedback** - Use progress bars, spinners, and status messages
4. **Handle connection failures gracefully** - Implement fallback to non-streaming mode
5. **Set reasonable timeouts** - Long-running operations should have timeout limits
6. **Clean up resources** - Always close EventSource connections when done
7. **Test with slow connections** - Ensure UI remains responsive during streaming 