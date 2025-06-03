import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { logger } from './utils/logger';
import { LLMGateway } from './services/llm-gateway';
import { ToolManager } from './tools/tool-manager';
import { MemoryManager } from './memory/memory-manager';
import { AgentOrchestrator } from './agent/orchestrator';
import { createAgentRoutes } from './routes/agent';
import { generalRateLimiter } from './middleware/rate-limit';

// Create logger for server
const serverLogger = logger.child({ module: 'server' });

async function startServer(): Promise<void> {
  try {
    // Initialize Express app
    const app = express();

    // Basic middleware
    app.use(helmet({
      contentSecurityPolicy: env.HELMET_CSP_DIRECTIVES ? {
        directives: {
          defaultSrc: ["'self'"],
          // Parse additional directives from env if needed
        },
      } : false,
    }));
    
    app.use(cors({
      origin: env.CORS_ORIGIN,
      credentials: true,
    }));
    
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    
    // Apply general rate limiting
    app.use(generalRateLimiter);

    // Health check endpoint
    app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        environment: env.NODE_ENV,
      });
    });

    // Initialize components
    serverLogger.info('Initializing components...');

    // Initialize LLM Gateway
    const llmGateway = new LLMGateway({
      temperature: 0.7,
      maxTokens: 2048,
    });

    // Initialize Tool Manager
    const toolManager = new ToolManager();

    // Initialize Memory Manager
    const memoryManager = new MemoryManager();
    await memoryManager.initialize();

    // Initialize Agent Orchestrator
    const orchestrator = new AgentOrchestrator(
      llmGateway,
      toolManager,
      memoryManager,
      {
        systemPrompt: `You are an advanced AI assistant powered by intelligent intent classification. 
You have access to:
- Web search capabilities for current information
- SQL database queries for structured data
- Short-term conversation memory
- Long-term vector memory for context

I use AI-based intent classification to understand your requests accurately and can:
- Detect when you need tools even without explicit keywords
- Understand context and references to previous conversations
- Ask for clarification when your intent is unclear
- Suggest enhanced versions of your queries for better results

How can I assist you today?`,
        minConfidenceThreshold: 0.7, // Requests below 70% confidence will trigger clarification
      }
    );

    // Mount routes
    app.use('/api/v1/agent', createAgentRoutes(orchestrator));

    // Error handling middleware
    app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
      serverLogger.error('Unhandled error', { 
        error: err.message, 
        stack: err.stack,
        path: req.path,
        method: req.method,
      });
      
      res.status(500).json({
        error: 'Internal server error',
        message: env.NODE_ENV === 'development' ? err.message : undefined,
      });
    });

    // 404 handler
    app.use((req, res) => {
      res.status(404).json({ error: 'Route not found' });
    });

    // Start server
    const server = app.listen(env.PORT, env.HOST, () => {
      serverLogger.info(`🚀 Server started`, {
        host: env.HOST,
        port: env.PORT,
        environment: env.NODE_ENV,
      });
    });

    // Graceful shutdown
    const gracefulShutdown = async (signal: string): Promise<void> => {
      serverLogger.info(`${signal} received, starting graceful shutdown...`);
      
      server.close(async () => {
        serverLogger.info('HTTP server closed');
        
        try {
          await memoryManager.close();
          serverLogger.info('Memory manager closed');
        } catch (error) {
          serverLogger.error('Error closing memory manager', { error });
        }
        
        process.exit(0);
      });

      // Force shutdown after 30 seconds
      setTimeout(() => {
        serverLogger.error('Graceful shutdown timeout, forcing exit');
        process.exit(1);
      }, 30000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    serverLogger.error('Failed to start server', { error });
    process.exit(1);
  }
}

// Start the server
startServer().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
}); 