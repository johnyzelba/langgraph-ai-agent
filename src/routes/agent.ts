import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { AgentOrchestrator, AgentRequestSchema } from '../agent/orchestrator';
import { verifyToken, requireRole } from '../middleware/auth';
import { strictRateLimiter } from '../middleware/rate-limit';
import { createLogger } from '../utils/logger';

const logger = createLogger('agent-routes');

// Request body schema
const ChatRequestSchema = z.object({
  message: z.string().min(1).max(10000),
  context: z.object({
    role: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  }).optional(),
  stream: z.boolean().default(false),
});

export const createAgentRoutes = (orchestrator: AgentOrchestrator): Router => {
  const router = Router();

  /**
   * POST /chat
   * Process a chat message
   */
  router.post('/chat',
    verifyToken,
    strictRateLimiter,
    async (req: Request, res: Response) => {
      try {
        // Validate request body
        const body = ChatRequestSchema.parse(req.body);
        
        // Build agent request
        const agentRequest = AgentRequestSchema.parse({
          userId: req.user!.userId,
          sessionId: req.headers['x-session-id'] || `default-${req.user!.userId}`,
          message: body.message,
          context: body.context,
          stream: body.stream,
        });

        logger.info('Processing chat request', {
          userId: agentRequest.userId,
          sessionId: agentRequest.sessionId,
          stream: agentRequest.stream,
        });

        if (body.stream) {
          // Set up SSE headers
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

          try {
            // Check if it's a chart request for special handling
            if (orchestrator.isChartRequestPublic(agentRequest.message)) {
              // Stream chart generation with progress events
              let finalResult: any;
              
              for await (const event of orchestrator.streamResponse(agentRequest)) {
                res.write(`data: ${JSON.stringify(event)}\n\n`);
              }

              // The final result is returned by the generator
              // Send completion event
              res.write(`data: ${JSON.stringify({ type: 'done', completed: true })}\n\n`);
            } else {
              // Stream regular operations with progress events
              for await (const event of orchestrator.streamResponse(agentRequest)) {
                res.write(`data: ${JSON.stringify(event)}\n\n`);
              }

              // Send completion event
              res.write(`data: ${JSON.stringify({ type: 'done', completed: true })}\n\n`);
            }
            
            res.end();
          } catch (error) {
            logger.error('Streaming error', { error });
            res.write(`data: ${JSON.stringify({ 
              type: 'error', 
              data: { 
                operation: 'streaming',
                message: 'Streaming failed',
                timestamp: Date.now()
              }
            })}\n\n`);
            res.end();
          }
        } else {
          // Regular response
          const response = await orchestrator.processRequest(agentRequest);
          res.json(response);
        }
      } catch (error) {
        logger.error('Chat request failed', { error });

        if (error instanceof z.ZodError) {
          res.status(400).json({
            error: 'Invalid request',
            details: error.errors,
          });
        } else {
          res.status(500).json({
            error: 'Failed to process message',
          });
        }
      }
    }
  );

  /**
   * GET /memory/stats
   * Get memory statistics for the current user
   */
  router.get('/memory/stats',
    verifyToken,
    async (req: Request, res: Response) => {
      try {
        const memoryManager = orchestrator['memoryManager'];
        const stats = await memoryManager.getMemoryStats(req.user!.userId);
        res.json(stats);
      } catch (error) {
        logger.error('Failed to get memory stats', { error });
        res.status(500).json({ error: 'Failed to get memory statistics' });
      }
    }
  );

  /**
   * DELETE /memory/session/:sessionId
   * Clear a specific session's memory
   */
  router.delete('/memory/session/:sessionId',
    verifyToken,
    async (req: Request, res: Response) => {
      try {
        const { sessionId } = req.params;
        if (!sessionId) {
          res.status(400).json({ error: 'Session ID is required' });
          return;
        }
        
        const memoryManager = orchestrator['memoryManager'];
        await memoryManager.clearSessionMemory(req.user!.userId, sessionId);
        res.json({ message: 'Session memory cleared' });
      } catch (error) {
        logger.error('Failed to clear session memory', { error });
        res.status(500).json({ error: 'Failed to clear session memory' });
      }
    }
  );

  /**
   * POST /memory/vector
   * Store a document in vector memory (admin only)
   */
  router.post('/memory/vector',
    verifyToken,
    requireRole('admin'),
    async (req: Request, res: Response) => {
      try {
        const { content, metadata } = z.object({
          content: z.string().min(1).max(50000),
          metadata: z.record(z.unknown()),
        }).parse(req.body);

        const memoryManager = orchestrator['memoryManager'];
        await memoryManager.storeVectorMemory(content, {
          ...metadata,
          uploadedBy: req.user!.userId,
        });

        res.json({ message: 'Document stored in vector memory' });
      } catch (error) {
        logger.error('Failed to store vector memory', { error });

        if (error instanceof z.ZodError) {
          res.status(400).json({
            error: 'Invalid request',
            details: error.errors,
          });
        } else {
          res.status(500).json({ error: 'Failed to store document' });
        }
      }
    }
  );

  /**
   * GET /tools
   * List available tools
   */
  router.get('/tools',
    verifyToken,
    async (req: Request, res: Response) => {
      try {
        const toolManager = orchestrator['toolManager'];
        const tools = toolManager.getAllTools().map(tool => ({
          name: tool.name,
          description: tool.description,
        }));
        res.json({ tools });
      } catch (error) {
        logger.error('Failed to list tools', { error });
        res.status(500).json({ error: 'Failed to list tools' });
      }
    }
  );

  return router;
}; 