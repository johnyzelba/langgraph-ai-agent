import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOpenAI } from '@langchain/openai';
import { BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { env } from '../config/env';
import { createLogger } from '../utils/logger';
import { z } from 'zod';

const logger = createLogger('llm-gateway');

// Configuration for LLM providers
interface LLMConfig {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  timeout?: number;
  maxRetries?: number;
}

// Response filtering schema
const SafeResponseSchema = z.object({
  content: z.string(),
  isHallucination: z.boolean().optional(),
  containsRestrictedContent: z.boolean().optional(),
});

export class LLMGateway {
  private primaryModel: ChatGoogleGenerativeAI;
  private fallbackModel?: ChatOpenAI;
  private readonly config: LLMConfig;

  constructor(config: LLMConfig = {}) {
    this.config = {
      temperature: 0.7,
      maxTokens: 2048,
      topP: 0.9,
      timeout: 30000,
      maxRetries: 3,
      ...config,
    };

    // Initialize Gemini as primary model
    this.primaryModel = new ChatGoogleGenerativeAI({
      model: 'gemini-2.5-flash',
      temperature: this.config.temperature,
      maxOutputTokens: this.config.maxTokens,
      topP: this.config.topP,
      apiKey: env.GOOGLE_GENAI_API_KEY,
    });

    // Initialize OpenAI as fallback if API key is provided
    if (env.OPENAI_API_KEY) {
      this.fallbackModel = new ChatOpenAI({
        model: 'gpt-4-turbo-preview',
        temperature: this.config.temperature,
        maxTokens: this.config.maxTokens,
        topP: this.config.topP,
        apiKey: env.OPENAI_API_KEY,
        timeout: this.config.timeout,
      });
    }

    logger.info('LLM Gateway initialized', {
      primaryModel: 'gemini-2.5-flash',
      fallbackModel: env.OPENAI_API_KEY ? 'gpt-4-turbo-preview' : 'none',
    });
  }

  /**
   * Sanitize user input to prevent prompt injection
   */
  private sanitizeInput(input: string): string {
    // Remove potential escape sequences
    let sanitized = input.replace(/\\[nrt]/g, ' ');
    
    // Remove potential instruction markers
    const instructionPatterns = [
      /ignore previous instructions/gi,
      /disregard all prior/gi,
      /forget everything/gi,
      /new instructions:/gi,
      /system:/gi,
      /assistant:/gi,
    ];

    for (const pattern of instructionPatterns) {
      sanitized = sanitized.replace(pattern, '');
    }

    // Limit input length
    if (sanitized.length > 10000) {
      sanitized = sanitized.substring(0, 10000) + '... [truncated]';
    }

    return sanitized.trim();
  }

  /**
   * Filter and validate LLM response
   */
  private async filterResponse(response: string): Promise<string> {
    // Check for potential hallucinations or restricted content
    const lowerResponse = response.toLowerCase();
    
    // Check for common hallucination patterns
    const hallucinationPatterns = [
      /as an ai language model/i,
      /i cannot access real-time/i,
      /my training data/i,
      /i don't have access to/i,
    ];

    const containsHallucination = hallucinationPatterns.some(pattern => 
      pattern.test(response)
    );

    // Check for restricted content
    const restrictedPatterns = [
      /\b(password|secret|key|token)\s*[:=]\s*[\w\-]+/i,
      /\b(api_key|apikey)\s*[:=]\s*[\w\-]+/i,
    ];

    const containsRestricted = restrictedPatterns.some(pattern => 
      pattern.test(response)
    );

    if (containsRestricted) {
      logger.warn('Filtered restricted content from response');
      response = response.replace(/\b(password|secret|key|token|api_key|apikey)\s*[:=]\s*[\w\-]+/gi, '[REDACTED]');
    }

    logger.debug('Response filtered', { 
      containsHallucination, 
      containsRestricted,
      responseLength: response.length 
    });

    return response;
  }

  /**
   * Generate a chat completion with retry and fallback logic
   */
  async generateCompletion(
    messages: BaseMessage[],
    options: Partial<LLMConfig> = {}
  ): Promise<string> {
    const startTime = Date.now();
    const mergedConfig = { ...this.config, ...options };

    // Sanitize all human messages
    const sanitizedMessages = messages.map(msg => {
      if (msg instanceof HumanMessage) {
        return new HumanMessage(this.sanitizeInput(msg.content as string));
      }
      return msg;
    });

    try {
      // Try primary model (Gemini)
      logger.debug('Attempting completion with primary model', {
        messageCount: sanitizedMessages.length,
        temperature: mergedConfig.temperature,
      });

      const response = await this.primaryModel.invoke(
        sanitizedMessages,
        {
          // Temperature is set in model config, not in call options
        }
      );

      const content = response.content as string;
      const filteredContent = await this.filterResponse(content);

      logger.info('Primary model completion successful', {
        duration: Date.now() - startTime,
        responseLength: filteredContent.length,
      });

      return filteredContent;
    } catch (primaryError) {
      logger.error('Primary model failed', { error: primaryError });

      // Try fallback model if available
      if (this.fallbackModel) {
        try {
          logger.info('Attempting fallback to OpenAI');
          
          const response = await this.fallbackModel.invoke(
            sanitizedMessages,
            {
              // Temperature is set in model config, not in call options
            }
          );

          const content = response.content as string;
          const filteredContent = await this.filterResponse(content);

          logger.info('Fallback model completion successful', {
            duration: Date.now() - startTime,
            responseLength: filteredContent.length,
          });

          return filteredContent;
        } catch (fallbackError) {
          logger.error('Fallback model also failed', { error: fallbackError });
          throw new Error('Both primary and fallback models failed');
        }
      }

      throw primaryError;
    }
  }

  /**
   * Stream a chat completion response
   */
  async *streamCompletion(
    messages: BaseMessage[],
    options: Partial<LLMConfig> = {}
  ): AsyncGenerator<string, void, unknown> {
    const mergedConfig = { ...this.config, ...options };

    // Sanitize all human messages
    const sanitizedMessages = messages.map(msg => {
      if (msg instanceof HumanMessage) {
        return new HumanMessage(this.sanitizeInput(msg.content as string));
      }
      return msg;
    });

    try {
      const stream = await this.primaryModel.stream(
        sanitizedMessages,
        {
          // Options are set in model config
        }
      );

      let fullResponse = '';
      for await (const chunk of stream) {
        const content = chunk.content as string;
        fullResponse += content;
        yield content;
      }

      // Filter the complete response at the end
      await this.filterResponse(fullResponse);
    } catch (error) {
      logger.error('Streaming failed', { error });
      
      // Fallback to non-streaming if streaming fails
      const response = await this.generateCompletion(messages, options);
      yield response;
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<LLMConfig>): void {
    Object.assign(this.config, config);
    logger.info('LLM configuration updated', config);
  }
} 