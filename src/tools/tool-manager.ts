import { Tool } from '@langchain/core/tools';
import { z } from 'zod';
import axios, { AxiosInstance } from 'axios';
import { env } from '../config/env';
import { createLogger } from '../utils/logger';

const logger = createLogger('tool-manager');

// Base MCP tool interface
interface MCPToolConfig {
  name: string;
  description: string;
  url: string;
  timeout?: number;
  rateLimit?: {
    maxRequests: number;
    windowMs: number;
  };
}

// Tool input/output schemas
const BrowserSearchSchema = z.object({
  query: z.string().min(1).max(500),
  maxResults: z.number().int().min(1).max(10).optional().default(5),
});

const SQLQuerySchema = z.object({
  query: z.string().min(1),
  database: z.string().optional(),
});

// Base MCP Tool class
abstract class MCPTool extends Tool {
  protected axiosClient: AxiosInstance;
  protected config: MCPToolConfig;
  private requestCount: Map<string, { count: number; resetTime: number }> = new Map();
  
  abstract name: string;
  abstract description: string;

  constructor(config: MCPToolConfig) {
    super();
    this.config = config;

    this.axiosClient = axios.create({
      baseURL: config.url,
      timeout: config.timeout || env.MCP_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add request interceptor for logging
    this.axiosClient.interceptors.request.use(
      (config) => {
        logger.debug(`MCP tool request: ${this.name}`, { 
          url: config.url,
          method: config.method,
        });
        return config;
      },
      (error) => {
        logger.error(`MCP tool request error: ${this.name}`, { error });
        return Promise.reject(error);
      }
    );

    // Add response interceptor for logging
    this.axiosClient.interceptors.response.use(
      (response) => {
        logger.debug(`MCP tool response: ${this.name}`, { 
          status: response.status,
          dataSize: JSON.stringify(response.data).length,
        });
        return response;
      },
      (error) => {
        logger.error(`MCP tool response error: ${this.name}`, { error });
        return Promise.reject(error);
      }
    );
  }

  protected async checkRateLimit(userId: string): Promise<boolean> {
    if (!this.config.rateLimit) return true;

    const now = Date.now();
    const userLimit = this.requestCount.get(userId);

    if (!userLimit || now > userLimit.resetTime) {
      this.requestCount.set(userId, {
        count: 1,
        resetTime: now + this.config.rateLimit.windowMs,
      });
      return true;
    }

    if (userLimit.count >= this.config.rateLimit.maxRequests) {
      logger.warn(`Rate limit exceeded for tool: ${this.name}`, { userId });
      return false;
    }

    userLimit.count++;
    return true;
  }

  async _call(input: string): Promise<string> {
    throw new Error('Must implement _call method');
  }
}

// Browser Search Tool
class BrowserSearchTool extends MCPTool {
  name = 'browser_search';
  description = 'Search the web for information using a browser-based search';

  constructor() {
    super({
      name: 'browser_search',
      description: 'Search the web for information using a browser-based search',
      url: env.MCP_BROWSER_SEARCH_URL,
      rateLimit: {
        maxRequests: 10,
        windowMs: 60000, // 1 minute
      },
    });
  }

  async _call(input: string, runManager?: any): Promise<string> {
    try {
      const parsed = BrowserSearchSchema.parse(JSON.parse(input));
      
      // Check rate limit
      const userId = runManager?.metadata?.userId || 'anonymous';
      if (!await this.checkRateLimit(userId)) {
        return JSON.stringify({ error: 'Rate limit exceeded' });
      }

      const response = await this.axiosClient.post('/search', {
        query: parsed.query,
        maxResults: parsed.maxResults,
      });

      return JSON.stringify(response.data);
    } catch (error) {
      logger.error('Browser search failed', { error });
      return JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Search failed' 
      });
    }
  }
}

// SQL Query Tool
class SQLQueryTool extends MCPTool {
  name = 'sql_query';
  description = 'Execute read-only SQL queries on available databases';
  
  private readonly dangerousPatterns = [
    /\b(DROP|DELETE|TRUNCATE|ALTER|CREATE|INSERT|UPDATE)\b/i,
    /\b(EXEC|EXECUTE)\b/i,
    /;\s*$/,
  ];

  constructor() {
    super({
      name: 'sql_query',
      description: 'Execute read-only SQL queries on available databases',
      url: env.MCP_SQL_QUERY_URL,
      rateLimit: {
        maxRequests: 20,
        windowMs: 60000, // 1 minute
      },
    });
  }

  private sanitizeQuery(query: string): string {
    // Check for dangerous operations
    for (const pattern of this.dangerousPatterns) {
      if (pattern.test(query)) {
        throw new Error('Unsafe SQL operation detected');
      }
    }

    // Ensure query starts with SELECT
    if (!query.trim().toUpperCase().startsWith('SELECT')) {
      throw new Error('Only SELECT queries are allowed');
    }

    return query.trim();
  }

  async _call(input: string, runManager?: any): Promise<string> {
    try {
      const parsed = SQLQuerySchema.parse(JSON.parse(input));
      
      // Check rate limit
      const userId = runManager?.metadata?.userId || 'anonymous';
      if (!await this.checkRateLimit(userId)) {
        return JSON.stringify({ error: 'Rate limit exceeded' });
      }

      // Sanitize query
      const sanitizedQuery = this.sanitizeQuery(parsed.query);
      
      logger.info('Executing SQL query', { 
        database: parsed.database,
        queryLength: sanitizedQuery.length,
      });

      const response = await this.axiosClient.post('/query', {
        query: sanitizedQuery,
        database: parsed.database,
      });

      return JSON.stringify(response.data);
    } catch (error) {
      logger.error('SQL query failed', { error });
      return JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Query failed' 
      });
    }
  }
}

// Tool Manager
export class ToolManager {
  private tools: Map<string, Tool> = new Map();

  constructor() {
    this.registerDefaultTools();
  }

  private registerDefaultTools(): void {
    // Register browser search tool
    const browserTool = new BrowserSearchTool();
    this.tools.set('browser', browserTool);
    this.tools.set('browser_search', browserTool);

    // Register SQL query tool
    const sqlTool = new SQLQueryTool();
    this.tools.set('sql_query', sqlTool);

    logger.info('Default tools registered', { 
      tools: Array.from(this.tools.keys()) 
    });
  }

  /**
   * Register a custom tool
   */
  registerTool(name: string, tool: Tool): void {
    this.tools.set(name, tool);
    logger.info(`Tool registered: ${name}`);
  }

  /**
   * Get a tool by name
   */
  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all available tools
   */
  getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tool names
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Execute a tool with proper error handling
   */
  async executeTool(
    toolName: string,
    input: unknown,
    metadata?: Record<string, unknown>
  ): Promise<unknown> {
    const tool = this.getTool(toolName);
    if (!tool) {
      throw new Error(`Tool not found: ${toolName}`);
    }

    const startTime = Date.now();
    
    try {
      const inputStr = typeof input === 'string' ? input : JSON.stringify(input);
      const result = await tool.invoke(inputStr, { metadata });
      
      logger.info('Tool executed successfully', {
        tool: toolName,
        duration: Date.now() - startTime,
      });

      return result;
    } catch (error) {
      logger.error('Tool execution failed', { 
        tool: toolName,
        error,
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }
} 