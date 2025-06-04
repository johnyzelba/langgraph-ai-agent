import { z } from 'zod';
import { BaseMessage, HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { LLMGateway } from '../services/llm-gateway';
import { ToolManager } from '../tools/tool-manager';
import { MemoryManager } from '../memory/memory-manager';
import { IntentClassifier, IntentClassification } from '../services/intent-classifier';
import { createLogger } from '../utils/logger';
import { env } from '../config/env';
import { runChartGeneration } from './chart-state-graph';
import { ChartGenerationState } from './chart-state-machine';
import { 
  ChartGenerationOperation, 
  ToolExecutionOperation, 
  LLMStreamingOperation 
} from './streaming-operations';
import { 
  StreamingOperation, 
  EventCallback, 
  ProgressEvent,
  createProgressEvent,
  createErrorEvent,
  createCompletionEvent
} from '../types/streaming';

const logger = createLogger('orchestrator');

// Request validation schema
export const AgentRequestSchema = z.object({
  userId: z.string(),
  sessionId: z.string(),
  message: z.string().min(1).max(10000),
  context: z.object({
    role: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  }).optional(),
  stream: z.boolean().default(false),
});

export type AgentRequest = z.infer<typeof AgentRequestSchema>;

// Response schema - Updated to support chart generation
export interface AgentResponse {
  message: string;
  toolsUsed?: string[];
  memoryContext?: {
    shortTerm: number;
    longTerm: number;
  };
  metadata?: Record<string, unknown>;
  chartData?: any; // Nivo chart data if chart was generated
  clarificationNeeded?: {
    question: string;
    options?: string[];
    context?: string;
  };
}

// Orchestrator configuration
interface OrchestratorConfig {
  systemPrompt?: string;
  maxToolCalls?: number;
  enableMemory?: boolean;
  enableRAG?: boolean;
  minConfidenceThreshold?: number;
  enableChartGeneration?: boolean;
}

export class AgentOrchestrator {
  private llmGateway: LLMGateway;
  private toolManager: ToolManager;
  private memoryManager: MemoryManager;
  private intentClassifier: IntentClassifier;
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
    this.intentClassifier = new IntentClassifier(llmGateway);
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
   * Process a user request - now with state machine support
   */
  async processRequest(request: AgentRequest): Promise<AgentResponse> {
    const startTime = Date.now();
    logger.info('Processing request', { 
      userId: request.userId, 
      sessionId: request.sessionId,
      messageLength: request.message.length 
    });

    try {
      // Validate request
      const validatedRequest = AgentRequestSchema.parse(request);

      // Check if this is a chart generation request
      if (this.config.enableChartGeneration && this.isChartRequest(validatedRequest.message)) {
        return await this.processChartRequest(validatedRequest);
      }

      // Otherwise, use the original processing logic
      return await this.processNormalRequest(validatedRequest);
    } catch (error) {
      logger.error('Error processing request', { error });
      throw error;
    }
  }

  /**
   * Check if the request is for chart generation
   */
  private isChartRequest(message: string): boolean {
    const chartKeywords = [
      'chart', 'graph', 'plot', 'visualize', 'visualization',
      'bar chart', 'line chart', 'pie chart', 'scatter plot',
      'heatmap', 'treemap', 'sankey', 'radar chart',
      'show me', 'display', 'create a chart', 'generate a graph'
    ];
    
    const lowerMessage = message.toLowerCase();
    return chartKeywords.some(keyword => lowerMessage.includes(keyword));
  }

  /**
   * Public method to check if request is for chart generation
   */
  isChartRequestPublic(message: string): boolean {
    return this.isChartRequest(message);
  }

  /**
   * Process a chart generation request using the state machine
   */
  private async processChartRequest(request: AgentRequest): Promise<AgentResponse> {
    logger.info('Processing chart generation request');

    const progressUpdates: ChartGenerationState['progress'][] = [];
    
    // Run the chart generation state machine
    const result = await runChartGeneration(
      request.message,
      request.userId,
      request.sessionId,
      {
        llmGateway: this.llmGateway,
        toolManager: this.toolManager,
        memoryManager: this.memoryManager,
        progressCallback: (progress) => {
          progressUpdates.push(progress);
          logger.debug('Chart generation progress', progress);
        },
      }
    );

    // Handle clarification needed
    if (result.clarificationNeeded) {
      return {
        message: result.clarificationNeeded.question,
        clarificationNeeded: result.clarificationNeeded,
        metadata: {
          progressUpdates,
          state: 'clarification_needed',
        },
      };
    }

    // Handle errors
    if (result.errors.length > 0) {
      return {
        message: `I encountered errors while generating the chart: ${result.errors.join(', ')}`,
        metadata: {
          errors: result.errors,
          progressUpdates,
          state: 'failed',
        },
      };
    }

    // Success - return the chart data
    if (result.finalChartData) {
      return {
        message: result.finalChartData.description || 'Here is your chart:',
        chartData: result.finalChartData,
        toolsUsed: ['sql_query'],
        metadata: {
          chartType: result.chartType,
          queryCount: result.sqlQueries.length,
          totalRows: result.queryResults.reduce((sum, r) => sum + r.rowCount, 0),
          progressUpdates,
          state: 'completed',
        },
      };
    }

    // Fallback
    return {
      message: 'Chart generation completed but no data was produced.',
      metadata: {
        progressUpdates,
        state: 'completed',
      },
    };
  }

  /**
   * Process a normal (non-chart) request
   */
  private async processNormalRequest(request: AgentRequest): Promise<AgentResponse> {
    // Build context
    const messages = await this.buildContext(request);

    // Decision engine
    const decision = await this.makeDecision(request, messages);
    
    let response: string;
    const toolsUsed: string[] = [];

    // Execute based on decision
    switch (decision.action) {
      case 'tools':
        const toolResults = await this.executeTools(decision.tools || [], request.message);
        toolsUsed.push(...toolResults.map(r => r.tool));
        
        // Add tool results to context
        messages.push(new AIMessage(`I'll use these tools: ${toolResults.map(r => r.tool).join(', ')}`));
        messages.push(new HumanMessage(`Tool results: ${JSON.stringify(toolResults)}`));
        
        // Generate final response with tool results
        response = await this.llmGateway.generateCompletion(messages);
        break;

      case 'memory':
        // Query memory was already done in buildContext
        response = await this.llmGateway.generateCompletion(messages);
        break;

      case 'clarify':
        // Ask for clarification
        response = await this.generateClarificationRequest(
          request.message,
          decision.reasoning,
          messages
        );
        break;

      case 'direct':
      default:
        // Direct LLM response
        // If there's a suggested prompt enhancement, use it
        if (decision.suggestedPromptEnhancement) {
          const enhancedMessages = [...messages.slice(0, -1)]; // Remove last message
          enhancedMessages.push(new HumanMessage(decision.suggestedPromptEnhancement));
          response = await this.llmGateway.generateCompletion(enhancedMessages);
        } else {
          response = await this.llmGateway.generateCompletion(messages);
        }
        break;
    }

    // Store in memory if enabled
    if (this.config.enableMemory) {
      await this.memoryManager.storeShortTermMemory(
        request.userId,
        request.sessionId,
        request.message,
        response
      );
    }

    const duration = Date.now() - Date.now();
    logger.info('Request processed successfully', { 
      duration,
      toolsUsed: toolsUsed.length,
      responseLength: response.length,
      decision: decision.action,
      confidence: decision.confidence,
    });

    return {
      message: response,
      toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined,
      memoryContext: {
        shortTerm: messages.filter(m => m._getType() === 'human').length,
        longTerm: 0, // Will be populated when RAG is implemented
      },
      metadata: {
        duration,
        decision: decision.action,
        confidence: decision.confidence,
        reasoning: decision.reasoning,
      },
    };
  }

  /**
   * Stream a response - Updated to support all operations
   */
  async *streamResponse(request: AgentRequest): AsyncGenerator<ProgressEvent, AgentResponse, unknown> {
    const startTime = Date.now();
    logger.info('Streaming response', { 
      userId: request.userId, 
      sessionId: request.sessionId 
    });

    try {
      // Validate request
      const validatedRequest = AgentRequestSchema.parse(request);

      // Check if this is a chart generation request
      if (this.config.enableChartGeneration && this.isChartRequest(validatedRequest.message)) {
        let finalResponse: AgentResponse;
        
        const eventCallback: EventCallback = (event) => {
          // Yield all events except completion (we'll handle that at the end)
          if (event.type !== 'done') {
            return event; // This will be yielded by the generator
          }
        };

        // Create an async generator that yields events and returns the final response
        const chartOperation = new ChartGenerationOperation(validatedRequest, {
          llmGateway: this.llmGateway,
          toolManager: this.toolManager,
          memoryManager: this.memoryManager,
        });

        // Execute with event yielding
        finalResponse = await chartOperation.execute((event) => {
          if (event.type !== 'done') {
            // We can't yield from inside a callback, so we'll need a different approach
            // For now, let's use the existing pattern and improve it later
          }
        });

        // For now, yield a simple progress event and return the result
        yield createProgressEvent('chart_generation', 'Chart generation completed', { percentage: 100 });
        return finalResponse;
      }

      // Build context for non-chart requests
      const messages = await this.buildContext(validatedRequest);
      const decision = await this.makeDecision(validatedRequest, messages);

      let finalResponse: AgentResponse;

      // Execute based on decision with streaming
      switch (decision.action) {
        case 'tools':
          if (decision.tools && decision.tools.length > 0) {
            // Yield initial progress
            yield createProgressEvent('tool_execution', 'Starting tool execution...', { percentage: 0 });

            const toolResults = await this.executeTools(decision.tools, validatedRequest.message);
            
            yield createProgressEvent('tool_execution', 'Tools executed, generating response...', { percentage: 50 });

            // Add tool results to context and generate final response
            messages.push(new AIMessage(`I'll use these tools: ${toolResults.map(r => r.tool).join(', ')}`));
            messages.push(new HumanMessage(`Tool results: ${JSON.stringify(toolResults)}`));
            
            // Stream the final LLM response
            yield createProgressEvent('llm_generation', 'Generating final response...', { percentage: 75 });
            
            const response = await this.llmGateway.generateCompletion(messages);
            
            finalResponse = {
              message: response,
              toolsUsed: toolResults.map(r => r.tool),
              memoryContext: {
                shortTerm: messages.filter(m => m._getType() === 'human').length,
                longTerm: 0,
              },
              metadata: {
                duration: Date.now() - startTime,
                decision: decision.action,
                confidence: decision.confidence,
                streamed: true,
              },
            };
          } else {
            // No tools to execute, fall back to direct LLM
            yield createProgressEvent('llm_generation', 'Generating response...', { percentage: 0 });
            
            const response = await this.llmGateway.generateCompletion(messages);
            
            finalResponse = {
              message: response,
              memoryContext: {
                shortTerm: messages.filter(m => m._getType() === 'human').length,
                longTerm: 0,
              },
              metadata: {
                duration: Date.now() - startTime,
                decision: decision.action,
                confidence: decision.confidence,
                streamed: true,
              },
            };
          }
          break;

        case 'clarify':
          yield createProgressEvent('clarification', 'Generating clarification request...', { percentage: 50 });
          
          // Generate clarification request
          const clarificationResponse = await this.generateClarificationRequest(
            validatedRequest.message,
            decision.reasoning,
            messages
          );
          
          finalResponse = {
            message: clarificationResponse,
            metadata: {
              duration: Date.now() - startTime,
              decision: decision.action,
              confidence: decision.confidence,
              streamed: true,
            },
          };
          break;

        case 'memory':
        case 'direct':
        default:
          yield createProgressEvent('llm_generation', 'Generating response...', { percentage: 0 });
          
          // Use enhanced prompt if available
          let response: string;
          if (decision.suggestedPromptEnhancement) {
            const enhancedMessages = [...messages.slice(0, -1)];
            enhancedMessages.push(new HumanMessage(decision.suggestedPromptEnhancement));
            response = await this.llmGateway.generateCompletion(enhancedMessages);
          } else {
            response = await this.llmGateway.generateCompletion(messages);
          }
          
          finalResponse = {
            message: response,
            memoryContext: {
              shortTerm: messages.filter(m => m._getType() === 'human').length,
              longTerm: 0,
            },
            metadata: {
              duration: Date.now() - startTime,
              decision: decision.action,
              confidence: decision.confidence,
              streamed: true,
            },
          };
          break;
      }

      // Store in memory if enabled
      if (this.config.enableMemory) {
        await this.memoryManager.storeShortTermMemory(
          validatedRequest.userId,
          validatedRequest.sessionId,
          validatedRequest.message,
          finalResponse.message
        );
      }

      // Yield final completion event
      yield createCompletionEvent('request_processing', 'Request completed successfully');

      return finalResponse;
    } catch (error) {
      logger.error('Error streaming response', { error });
      yield createErrorEvent('request_processing', `Request failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Build context from memory and RAG
   */
  private async buildContext(request: AgentRequest): Promise<BaseMessage[]> {
    const messages: BaseMessage[] = [
      new SystemMessage(this.config.systemPrompt),
    ];

    // Add short-term memory context
    if (this.config.enableMemory) {
      const recentMessages = await this.memoryManager.getRecentMessages(
        request.userId,
        request.sessionId,
        5 // Last 5 exchanges
      );

      for (const msg of recentMessages) {
        messages.push(new HumanMessage(msg.userMessage));
        messages.push(new AIMessage(msg.assistantResponse));
      }
    }

    // Add RAG context if enabled
    if (this.config.enableRAG && request.context?.role) {
      const ragContext = await this.memoryManager.queryVectorMemory(
        request.message,
        {
          role: request.context.role,
          limit: 3,
        }
      );

      if (ragContext.length > 0) {
        const contextStr = ragContext.map((doc) => doc.pageContent).join('\n\n');
        messages.push(new SystemMessage(`Relevant context:\n${contextStr}`));
      }
    }

    // Add current message
    messages.push(new HumanMessage(request.message));

    return messages;
  }

  /**
   * Decision engine to determine action
   */
  private async makeDecision(
    request: AgentRequest,
    messages: BaseMessage[]
  ): Promise<IntentClassification> {
    // Prepare context for classifier
    const classifierContext = {
      hasMemoryContext: messages.length > 3,
      availableTools: this.toolManager.getToolNames(),
      userRole: request.context?.role,
      conversationLength: messages.filter(m => m._getType() === 'human').length,
    };

    // Classify intent
    const classification = await this.intentClassifier.classify(
      request.message,
      classifierContext
    );

    // Log decision details
    logger.info('Intent classification result', {
      message: request.message.substring(0, 50),
      ...classification,
    });

    // Apply confidence threshold
    if (classification.confidence < this.config.minConfidenceThreshold) {
      logger.warn('Low confidence classification, defaulting to clarification', {
        confidence: classification.confidence,
        threshold: this.config.minConfidenceThreshold,
      });

      return {
        action: 'clarify',
        reasoning: `Low confidence (${classification.confidence.toFixed(2)}) in understanding your request. ${classification.reasoning}`,
        confidence: classification.confidence,
      };
    }

    return classification;
  }

  /**
   * Generate a clarification request
   */
  private async generateClarificationRequest(
    originalMessage: string,
    reasoning: string,
    messages: BaseMessage[]
  ): Promise<string> {
    const clarificationMessages = [
      ...messages.slice(0, -1), // Remove the original user message
      new SystemMessage(
        `The user's request is unclear or ambiguous. Generate a polite clarification request. 
        Reasoning: ${reasoning}
        Suggest specific options or examples to help the user clarify their intent.`
      ),
      new HumanMessage(originalMessage),
    ];

    return await this.llmGateway.generateCompletion(clarificationMessages, {
      temperature: 0.7,
      maxTokens: 300,
    });
  }

  /**
   * Execute tools based on the decision
   */
  private async executeTools(
    toolNames: string[],
    query: string
  ): Promise<Array<{ tool: string; result: unknown }>> {
    const results: Array<{ tool: string; result: unknown }> = [];

    for (const toolName of toolNames) {
      try {
        const tool = this.toolManager.getTool(toolName);
        if (tool) {
          const result = await tool.invoke(query);
          results.push({ tool: toolName, result });
        }
      } catch (error) {
        logger.error(`Tool execution failed: ${toolName}`, { error });
        results.push({ 
          tool: toolName, 
          result: { error: 'Tool execution failed' } 
        });
      }
    }

    return results;
  }

  /**
   * Universal streaming method for any operation
   */
  async streamOperation<T>(
    operation: StreamingOperation<T>,
    eventCallback: EventCallback
  ): Promise<T> {
    logger.info('Starting streaming operation', { 
      operationName: operation.operationName 
    });

    try {
      eventCallback(createProgressEvent(
        operation.operationName,
        'Operation starting...',
        { percentage: 0 }
      ));

      const result = await operation.execute(eventCallback);

      eventCallback(createCompletionEvent(
        operation.operationName,
        'Operation completed successfully'
      ));

      return result;
    } catch (error) {
      const errorMessage = `Operation ${operation.operationName} failed: ${error instanceof Error ? error.message : String(error)}`;
      
      eventCallback(createErrorEvent(
        operation.operationName,
        errorMessage,
        { error: error instanceof Error ? error.message : String(error) }
      ));

      throw error;
    }
  }

  /**
   * Stream chart generation with real-time progress updates
   */
  async streamChartGeneration(
    request: AgentRequest, 
    eventCallback: EventCallback
  ): Promise<AgentResponse> {
    const operation = new ChartGenerationOperation(request, {
      llmGateway: this.llmGateway,
      toolManager: this.toolManager,
      memoryManager: this.memoryManager,
    });

    return await this.streamOperation(operation, eventCallback);
  }

  /**
   * Stream tool execution with progress updates
   */
  async streamToolExecution(
    toolNames: string[],
    query: string,
    eventCallback: EventCallback
  ): Promise<Array<{ tool: string; result: unknown }>> {
    const operation = new ToolExecutionOperation(toolNames, query, {
      llmGateway: this.llmGateway,
      toolManager: this.toolManager,
      memoryManager: this.memoryManager,
    });

    return await this.streamOperation(operation, eventCallback);
  }

  /**
   * Stream LLM generation with content and progress updates
   */
  async streamLLMGeneration(
    messages: BaseMessage[],
    eventCallback: EventCallback
  ): Promise<string> {
    const operation = new LLMStreamingOperation(messages, {
      llmGateway: this.llmGateway,
      toolManager: this.toolManager,
      memoryManager: this.memoryManager,
    });

    return await this.streamOperation(operation, eventCallback);
  }
} 