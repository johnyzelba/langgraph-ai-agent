import { z } from 'zod';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { LLMGateway } from './llm-gateway';
import { createLogger } from '../utils/logger';

const logger = createLogger('intent-classifier');

// Intent classification result schema
export const IntentClassificationSchema = z.object({
  action: z.enum(['tools', 'memory', 'direct', 'clarify']),
  tools: z.array(z.string()).optional(),
  reasoning: z.string(),
  confidence: z.number().min(0).max(1),
  suggestedPromptEnhancement: z.string().optional(),
});

export type IntentClassification = z.infer<typeof IntentClassificationSchema>;

// Cache entry type
interface CacheEntry {
  data: IntentClassification;
  timestamp: number;
}

// Training examples for few-shot learning
const CLASSIFICATION_EXAMPLES = [
  {
    input: "Search for the latest news about AI",
    output: {
      action: "tools",
      tools: ["browser"],
      reasoning: "User explicitly wants to search for current information",
      confidence: 0.95
    }
  },
  {
    input: "What did we discuss earlier?",
    output: {
      action: "memory",
      reasoning: "User is asking about previous conversation",
      confidence: 0.9
    }
  },
  {
    input: "Show me all customers who made purchases last month",
    output: {
      action: "tools",
      tools: ["sql"],
      reasoning: "User wants to query database for customer data",
      confidence: 0.85
    }
  },
  {
    input: "Explain quantum computing",
    output: {
      action: "direct",
      reasoning: "General knowledge question that doesn't require tools or memory",
      confidence: 0.9
    }
  },
  {
    input: "Find recent papers on machine learning and summarize their findings",
    output: {
      action: "tools",
      tools: ["browser"],
      reasoning: "Requires searching for recent information and analysis",
      confidence: 0.88
    }
  }
];

export class IntentClassifier {
  private llmGateway: LLMGateway;
  private cache: Map<string, CacheEntry> = new Map();
  private readonly cacheMaxSize = 1000;
  private readonly cacheTTL = 3600000; // 1 hour in ms

  constructor(llmGateway: LLMGateway) {
    this.llmGateway = llmGateway;
    logger.info('Intent classifier initialized');
  }

  /**
   * Classify user intent using AI
   */
  async classify(
    message: string,
    context?: {
      hasMemoryContext?: boolean;
      availableTools?: string[];
      userRole?: string;
      conversationLength?: number;
    }
  ): Promise<IntentClassification> {
    const cacheKey = this.getCacheKey(message, context);
    
    // Check cache
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      logger.debug('Intent classification cache hit', { message: message.substring(0, 50) });
      return cached;
    }

    try {
      const classification = await this.performClassification(message, context);
      
      // Validate and cache result
      const validated = IntentClassificationSchema.parse(classification);
      this.addToCache(cacheKey, validated);
      
      logger.info('Intent classified', {
        message: message.substring(0, 50),
        action: validated.action,
        confidence: validated.confidence,
      });
      
      return validated;
    } catch (error) {
      logger.error('Intent classification failed', { error });
      
      // Fallback to rule-based classification
      return this.fallbackClassification(message);
    }
  }

  /**
   * Perform AI-based classification
   */
  private async performClassification(
    message: string,
    context?: {
      hasMemoryContext?: boolean;
      availableTools?: string[];
      userRole?: string;
      conversationLength?: number;
    }
  ): Promise<IntentClassification> {
    const systemPrompt = this.buildSystemPrompt(context);
    const userPrompt = this.buildUserPrompt(message, context);

    const response = await this.llmGateway.generateCompletion([
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt),
    ], {
      temperature: 0.3, // Lower temperature for more consistent classification
      maxTokens: 500,
    });

    // Parse JSON response
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      
      return JSON.parse(jsonMatch[0]);
    } catch (error) {
      logger.error('Failed to parse classification response', { error, response });
      throw error;
    }
  }

  /**
   * Build system prompt for classification
   */
  private buildSystemPrompt(context?: any): string {
    const examples = CLASSIFICATION_EXAMPLES.map(ex => 
      `Input: "${ex.input}"\nOutput: ${JSON.stringify(ex.output, null, 2)}`
    ).join('\n\n');

    return `You are an intent classifier for an AI assistant. Analyze user messages and classify them into one of these actions:

1. "tools" - User needs external tools (browser search, SQL queries, etc.)
2. "memory" - User is referencing previous conversation or needs context
3. "direct" - User has a general question that can be answered directly
4. "clarify" - User's intent is unclear and needs clarification

Consider these factors:
- Temporal indicators (latest, recent, current, now) often suggest tool use
- References to "earlier", "before", "we discussed" suggest memory
- Questions about general knowledge or explanations suggest direct response
- Ambiguous or incomplete requests should be clarified

Examples:
${examples}

Return a JSON object with:
{
  "action": "tools|memory|direct|clarify",
  "tools": ["browser", "sql"], // only if action is "tools"
  "reasoning": "Brief explanation of the decision",
  "confidence": 0.0-1.0,
  "suggestedPromptEnhancement": "Optional enhanced version of the user's query"
}`;
  }

  /**
   * Build user prompt for classification
   */
  private buildUserPrompt(message: string, context?: any): string {
    let prompt = `Classify this user message: "${message}"`;
    
    if (context) {
      const contextInfo: string[] = [];
      
      if (context.hasMemoryContext) {
        contextInfo.push('Has previous conversation context available');
      }
      
      if (context.availableTools?.length) {
        contextInfo.push(`Available tools: ${context.availableTools.join(', ')}`);
      }
      
      if (context.userRole) {
        contextInfo.push(`User role: ${context.userRole}`);
      }
      
      if (context.conversationLength) {
        contextInfo.push(`Conversation length: ${context.conversationLength} messages`);
      }
      
      if (contextInfo.length > 0) {
        prompt += `\n\nContext:\n${contextInfo.join('\n')}`;
      }
    }
    
    return prompt;
  }

  /**
   * Fallback rule-based classification
   */
  private fallbackClassification(message: string): IntentClassification {
    const lowerMessage = message.toLowerCase();
    
    // Check for tool indicators
    const browserKeywords = ['search', 'browse', 'web', 'google', 'find online', 'latest', 'recent', 'current'];
    const sqlKeywords = ['query', 'database', 'sql', 'select from', 'data from', 'customers', 'orders', 'transactions'];
    const memoryKeywords = ['earlier', 'before', 'previous', 'discussed', 'remember', 'last time'];
    
    const hasBrowserKeywords = browserKeywords.some(kw => lowerMessage.includes(kw));
    const hasSqlKeywords = sqlKeywords.some(kw => lowerMessage.includes(kw));
    const hasMemoryKeywords = memoryKeywords.some(kw => lowerMessage.includes(kw));
    
    if (hasBrowserKeywords || hasSqlKeywords) {
      const tools: string[] = [];
      if (hasBrowserKeywords) tools.push('browser');
      if (hasSqlKeywords) tools.push('sql');
      
      return {
        action: 'tools',
        tools,
        reasoning: 'Detected tool-related keywords in message',
        confidence: 0.6,
      };
    }
    
    if (hasMemoryKeywords) {
      return {
        action: 'memory',
        reasoning: 'Detected memory-related keywords in message',
        confidence: 0.6,
      };
    }
    
    // Check if the message is very short or unclear
    if (message.split(' ').length < 3 || message.endsWith('?') && message.length < 20) {
      return {
        action: 'clarify',
        reasoning: 'Message is too short or unclear',
        confidence: 0.5,
      };
    }
    
    return {
      action: 'direct',
      reasoning: 'No specific indicators found, defaulting to direct response',
      confidence: 0.5,
    };
  }

  /**
   * Generate cache key
   */
  private getCacheKey(message: string, context?: any): string {
    const contextStr = context ? JSON.stringify(context) : '';
    return `${message.toLowerCase().trim()}_${contextStr}`;
  }

  /**
   * Get from cache
   */
  private getFromCache(key: string): IntentClassification | null {
    const cached = this.cache.get(key);
    if (!cached) return null;
    
    const { data, timestamp } = cached;
    if (Date.now() - timestamp > this.cacheTTL) {
      this.cache.delete(key);
      return null;
    }
    
    return data;
  }

  /**
   * Add to cache
   */
  private addToCache(key: string, data: IntentClassification): void {
    // Implement simple LRU by removing oldest entries
    if (this.cache.size >= this.cacheMaxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
    logger.info('Intent classification cache cleared');
  }
} 