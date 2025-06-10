import { BaseMessage, HumanMessage } from '@langchain/core/messages';
import { runAgentFlow } from './chart-state-graph';
import { LLMGateway } from '../services/llm-gateway';
import { ToolManager } from '../tools/tool-manager';
import { MemoryManager } from '../memory/memory-manager';
import { 
  StreamingOperation, 
  EventCallback, 
  createProgressEvent, 
  createErrorEvent,
  createCompletionEvent,
  createContentEvent
} from '../types/streaming';
import { 
  AgentRequest, 
  AgentResponse, 
  OperationDependencies 
} from './types';
import { createLogger } from '../utils/logger';

const logger = createLogger('streaming-operations');

/**
 * Chart Generation Streaming Operation
 */
// This class is now a bit of a misnomer, it's more of a "AgentFlowOperation"
// but we'll keep the name for now to minimize changes.
export class ChartGenerationOperation implements StreamingOperation<AgentResponse> {
  readonly operationName: string = 'chart_generation';

  constructor(
    private request: AgentRequest,
    private deps: OperationDependencies
  ) {}

  async execute(progressCallback: EventCallback): Promise<AgentResponse> {
    logger.info('Starting chart generation operation', { 
      userId: this.request.userId,
      sessionId: this.request.sessionId 
    });

    progressCallback(createProgressEvent(
      this.operationName,
      'Starting agent flow...',
      { percentage: 0 }
    ));

    try {
      // Run the agent state machine with real-time progress
      const result = await runAgentFlow(
        this.request.message,
        this.request.userId,
        this.request.sessionId,
        {
          ...this.deps,
          progressCallback: (progress) => {
            progressCallback(createProgressEvent(
              this.operationName,
              progress.message,
              {
                currentState: progress.currentState,
                percentage: progress.percentage,
                metadata: { state: progress.currentState }
              }
            ));
          },
        }
      );

      // Handle clarification needed
      if (result.clarificationNeeded) {
        const response: AgentResponse = {
          message: result.clarificationNeeded.question,
          clarificationNeeded: {
            ...result.clarificationNeeded,
            answersArray: result.clarificationNeeded.options, // Provide both for compatibility
          },
          metadata: { state: 'clarification_needed' },
        };

        progressCallback(createCompletionEvent(
          this.operationName,
          'Clarification needed',
          { state: 'clarification_needed' }
        ));

        return response;
      }

      // Handle errors
      if (result.errors.length > 0) {
        const errorMessage = `Flow failed: ${result.errors.join(', ')}`;
        
        progressCallback(createErrorEvent(
          this.operationName,
          errorMessage,
          { errors: result.errors }
        ));

        return {
          message: errorMessage,
          metadata: { errors: result.errors, state: 'failed' },
        };
      }

      // Success (chart)
      if (result.finalChartData) {
        const response: AgentResponse = {
          message: result.finalChartData?.description || 'Chart generated successfully',
          chartData: result.finalChartData,
          metadata: {
            chartType: result.chartType,
            queryCount: result.sqlQueries.length,
            totalRows: result.queryResults.reduce((sum: number, r: { rowCount: number }) => sum + r.rowCount, 0),
            state: 'completed',
          },
        };

        progressCallback(createCompletionEvent(
          this.operationName,
          'Chart generation completed successfully',
          { 
            chartType: result.chartType,
            queryCount: result.sqlQueries.length,
            state: 'completed'
          }
        ));
        return response;
      }

      // Success (chat)
      if (result.chatResponse) {
        const response: AgentResponse = {
          message: result.chatResponse,
          metadata: { state: 'completed' },
        };
        progressCallback(createCompletionEvent(
          this.operationName,
          'Chat response generated successfully',
          { state: 'completed' }
        ));
        return response;
      }

      // Fallback for completion
      const fallbackResponse: AgentResponse = {
        message: 'Flow completed without specific output.',
        metadata: { state: 'completed' },
      };
      progressCallback(createCompletionEvent(
        this.operationName,
        'Flow completed',
        { state: 'completed' }
      ));
      return fallbackResponse;

    } catch (error) {
      const errorMessage = `Agent flow failed: ${error instanceof Error ? error.message : String(error)}`;
      
      progressCallback(createErrorEvent(
        this.operationName,
        errorMessage,
        { error: error instanceof Error ? error.message : String(error) }
      ));

      throw error;
    }
  }
}

/**
 * Tool Execution Streaming Operation
 */
export class ToolExecutionOperation implements StreamingOperation<Array<{ tool: string; result: unknown }>> {
  readonly operationName: string = 'tool_execution';

  constructor(
    private toolNames: string[],
    private query: string,
    private deps: OperationDependencies
  ) {}

  async execute(progressCallback: EventCallback): Promise<Array<{ tool: string; result: unknown }>> {
    logger.info('Starting tool execution operation', { 
      tools: this.toolNames,
      query: this.query.substring(0, 100) 
    });

    progressCallback(createProgressEvent(
      this.operationName,
      `Executing ${this.toolNames.length} tools...`,
      { percentage: 0 }
    ));

    const results: Array<{ tool: string; result: unknown }> = [];
    const totalTools = this.toolNames.length;

    for (let i = 0; i < this.toolNames.length; i++) {
      const toolName = this.toolNames[i];
      if (!toolName) continue; // Skip if toolName is undefined
      
      const percentage = Math.round(((i + 1) / totalTools) * 100);

      progressCallback(createProgressEvent(
        this.operationName,
        `Executing tool: ${toolName}`,
        { 
          percentage,
          currentState: `executing_${toolName}`,
          metadata: { currentTool: toolName, toolIndex: i + 1, totalTools }
        }
      ));

      try {
        const tool = this.deps.toolManager.getTool(toolName);
        if (tool) {
          const result = await tool.invoke(this.query);
          results.push({ tool: toolName, result });
          
          progressCallback(createProgressEvent(
            this.operationName,
            `Tool ${toolName} completed successfully`,
            { 
              percentage,
              currentState: `completed_${toolName}`,
              metadata: { completedTool: toolName }
            }
          ));
        } else {
          const errorResult = { error: `Tool ${toolName} not found` };
          results.push({ tool: toolName, result: errorResult });
          
          progressCallback(createProgressEvent(
            this.operationName,
            `Tool ${toolName} not found`,
            { 
              percentage,
              currentState: `error_${toolName}`,
              metadata: { errorTool: toolName }
            }
          ));
        }
      } catch (error) {
        logger.error(`Tool execution failed: ${toolName}`, { error });
        const errorResult = { error: 'Tool execution failed' };
        results.push({ tool: toolName, result: errorResult });
        
        progressCallback(createProgressEvent(
          this.operationName,
          `Tool ${toolName} failed: ${error instanceof Error ? error.message : String(error)}`,
          { 
            percentage,
            currentState: `failed_${toolName}`,
            metadata: { failedTool: toolName, error: error instanceof Error ? error.message : String(error) }
          }
        ));
      }
    }

    progressCallback(createCompletionEvent(
      this.operationName,
      `All tools executed. ${results.length} results obtained.`,
      { 
        totalTools,
        successfulTools: results.filter(r => !('error' in (r.result as any))).length,
        failedTools: results.filter(r => ('error' in (r.result as any))).length
      }
    ));

    return results;
  }
}

/**
 * LLM Streaming Operation
 */
export class LLMStreamingOperation implements StreamingOperation<string> {
  readonly operationName: string = 'llm_generation';

  constructor(
    private messages: BaseMessage[],
    private deps: OperationDependencies
  ) {}

  async execute(progressCallback: EventCallback): Promise<string> {
    logger.info('Starting LLM streaming operation');

    progressCallback(createProgressEvent(
      this.operationName,
      'Starting LLM response generation...',
      { percentage: 0 }
    ));

    try {
      let fullResponse = '';
      let chunkCount = 0;

      for await (const chunk of this.deps.llmGateway.streamCompletion(this.messages)) {
        fullResponse += chunk;
        chunkCount++;

        // Send content event for each chunk
        progressCallback(createContentEvent(this.operationName, chunk));

        // Send periodic progress updates
        if (chunkCount % 10 === 0) {
          progressCallback(createProgressEvent(
            this.operationName,
            `Generated ${fullResponse.length} characters...`,
            { 
              percentage: Math.min(90, Math.floor(fullResponse.length / 10)), // Rough estimate
              metadata: { chunkCount, responseLength: fullResponse.length }
            }
          ));
        }
      }

      progressCallback(createCompletionEvent(
        this.operationName,
        'LLM response generation completed',
        { 
          responseLength: fullResponse.length,
          chunkCount
        }
      ));

      return fullResponse;
    } catch (error) {
      const errorMessage = `LLM generation failed: ${error instanceof Error ? error.message : String(error)}`;
      
      progressCallback(createErrorEvent(
        this.operationName,
        errorMessage,
        { error: error instanceof Error ? error.message : String(error) }
      ));

      throw error;
    }
  }
} 