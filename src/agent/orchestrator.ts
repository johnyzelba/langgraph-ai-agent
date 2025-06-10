import { LLMGateway } from '../services/llm-gateway';
import { ToolManager } from '../tools/tool-manager';
import { MemoryManager } from '../memory/memory-manager';
import { createLogger } from '../utils/logger';
import { runAgentFlow } from './chart-state-graph';
import { 
  ProgressEvent,
  createProgressEvent,
  createErrorEvent,
  createCompletionEvent
} from '../types/streaming';
import { 
  AgentRequest, 
  AgentRequestSchema, 
  AgentResponse, 
  AgentState, 
  OrchestratorConfig 
} from './types';

const logger = createLogger('orchestrator');

export class AgentOrchestrator {
  private llmGateway: LLMGateway;
  private toolManager: ToolManager;
  private memoryManager: MemoryManager;
  private config: Required<OrchestratorConfig>;

  constructor(
    llmGateway: LLMGateway,
    toolManager: ToolManager,
    memoryManager: MemoryManager,
    config: OrchestratorConfig = {}
  ) {
    this.llmGateway = llmGateway;
    this.toolManager = toolManager;
    this.memoryManager = memoryManager;
    this.config = {
      systemPrompt: 'You are a helpful AI assistant with access to various tools and memory capabilities.',
      maxToolCalls: 5,
      enableMemory: true,
      enableRAG: true,
      minConfidenceThreshold: 0.7,
      enableChartGeneration: true,
      ...config,
    };

    logger.info('Agent orchestrator initialized', this.config);
  }

  /**
   * Process a user request using the unified agent graph
   */
  async processRequest(request: AgentRequest): Promise<AgentResponse> {
    logger.info('Processing request via unified agent graph', { 
      userId: request.userId, 
      sessionId: request.sessionId,
    });

    try {
      const validatedRequest = AgentRequestSchema.parse(request);

      const finalState = await runAgentFlow(
        validatedRequest.message,
        validatedRequest.userId,
        validatedRequest.sessionId,
        {
          llmGateway: this.llmGateway,
          toolManager: this.toolManager,
          memoryManager: this.memoryManager,
        }
      );

      const response = this.buildResponseFromState(finalState);

      // Save the conversation turn to memory
      await this.memoryManager.storeShortTermMemory(
        validatedRequest.userId,
        validatedRequest.sessionId,
        validatedRequest.message,
        response.message // The final message sent to the user
      );

      return response;
    } catch (error) {
      logger.error('Error processing request', { error });
      throw error;
    }
  }

  /**
   * Builds the final AgentResponse from the agent's final state
   */
  private buildResponseFromState(state: AgentState): AgentResponse {
    if (state.clarificationNeeded) {
      return {
        message: state.clarificationNeeded.question,
        clarificationNeeded: state.clarificationNeeded,
        metadata: { state: 'clarification_needed' },
      };
    }

    if (state.errors.length > 0) {
      return {
        message: `I encountered errors: ${state.errors.join(', ')}`,
        metadata: { errors: state.errors, state: 'failed' },
      };
    }

    if (state.finalChartData) {
      return {
        message: state.finalChartData.description || 'Here is your chart:',
        chartData: state.finalChartData,
        metadata: { chartType: state.chartType, state: 'completed' },
      };
    }

    if (state.chatResponse) {
      return {
        message: state.chatResponse,
        metadata: { state: 'completed' },
      };
    }

    return {
      message: 'The request completed, but I have no specific output.',
      metadata: { state: 'completed_empty' },
    };
  }

  /**
   * Stream a response using the unified agent graph
   */
  async *streamResponse(request: AgentRequest): AsyncGenerator<ProgressEvent, AgentResponse, unknown> {
    logger.info('Streaming response via unified agent graph', { 
      userId: request.userId, 
      sessionId: request.sessionId 
    });

    const eventQueue: ProgressEvent[] = [];
    let isCompleted = false;
    let finalState: AgentState | undefined;
    let agentError: Error | undefined;

    try {
      const validatedRequest = AgentRequestSchema.parse(request);

      runAgentFlow(
        validatedRequest.message,
        validatedRequest.userId,
        validatedRequest.sessionId,
        {
          llmGateway: this.llmGateway,
          toolManager: this.toolManager,
          memoryManager: this.memoryManager,
          progressCallback: (progress) => {
            eventQueue.push(
              createProgressEvent(
                'agent_flow', 
                progress.message, 
                { percentage: progress.percentage, currentState: progress.currentState }
              )
            );
          },
        }
      ).then(state => {
        finalState = state;
      }).catch(err => {
        agentError = err;
      }).finally(() => {
        isCompleted = true;
      });

      while (!isCompleted) {
        while (eventQueue.length > 0) {
          yield eventQueue.shift()!;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      while (eventQueue.length > 0) {
        yield eventQueue.shift()!;
      }

      if (agentError) {
        throw agentError;
      }

      if (!finalState) {
        throw new Error("Agent flow finished without a final state.");
      }

      const finalResponse = this.buildResponseFromState(finalState);
      
      // Save the conversation turn to memory after streaming
      await this.memoryManager.storeShortTermMemory(
        validatedRequest.userId,
        validatedRequest.sessionId,
        validatedRequest.message,
        finalResponse.message
      );
      
      yield createCompletionEvent('agent_flow', finalResponse.message, finalResponse as unknown as Record<string, unknown>);

      return finalResponse;

    } catch (error) {
      logger.error('Error streaming response', { error });
      const errorMessage = error instanceof Error ? error.message : String(error);
      yield createErrorEvent('agent_flow', `Request failed: ${errorMessage}`);
      throw error;
    }
  }
} 