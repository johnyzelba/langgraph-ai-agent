import Redis from 'ioredis';
import { QdrantClient } from '@qdrant/js-client-rest';
import { Document } from '@langchain/core/documents';
import { OpenAIEmbeddings } from '@langchain/openai';
import { QdrantVectorStore } from '@langchain/qdrant';
import { env } from '../config/env';
import { createLogger } from '../utils/logger';
import { z } from 'zod';

const logger = createLogger('memory-manager');

// Schema definitions
const ChatMessageSchema = z.object({
  userId: z.string(),
  sessionId: z.string(),
  userMessage: z.string(),
  assistantResponse: z.string(),
  timestamp: z.number(),
  metadata: z.record(z.unknown()).optional(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

const VectorQueryOptionsSchema = z.object({
  role: z.string().optional(),
  limit: z.number().int().min(1).max(20).default(5),
  scoreThreshold: z.number().min(0).max(1).optional(),
  filter: z.record(z.unknown()).optional(),
});

export type VectorQueryOptions = z.infer<typeof VectorQueryOptionsSchema>;

// Memory Manager class
export class MemoryManager {
  private redis: Redis;
  private qdrantClient: QdrantClient;
  private embeddings: OpenAIEmbeddings;
  private vectorStore?: QdrantVectorStore;
  private initialized = false;

  constructor() {
    // Initialize Redis
    this.redis = new Redis({
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      password: env.REDIS_PASSWORD,
      db: env.REDIS_DB,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        logger.warn(`Redis reconnection attempt ${times}, delay: ${delay}ms`);
        return delay;
      },
    });

    // Redis event handlers
    this.redis.on('connect', () => {
      logger.info('Redis connected');
    });

    this.redis.on('error', (error) => {
      logger.error('Redis error', { error });
    });

    // Initialize Qdrant client
    this.qdrantClient = new QdrantClient({
      url: env.QDRANT_URL,
      apiKey: env.QDRANT_API_KEY || undefined,
    });

    // Initialize embeddings (requires OpenAI API key)
    if (env.OPENAI_API_KEY) {
      this.embeddings = new OpenAIEmbeddings({
        openAIApiKey: env.OPENAI_API_KEY,
        modelName: 'text-embedding-3-small',
      });
    } else {
      logger.warn('OpenAI API key not provided, vector memory will be disabled');
      this.embeddings = {} as OpenAIEmbeddings;
    }
  }

  /**
   * Initialize the memory system
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Check Redis connection
      await this.redis.ping();
      logger.info('Redis connection verified');

      // Initialize Qdrant collection if OpenAI key is available
      if (env.OPENAI_API_KEY) {
        await this.initializeQdrantCollection();
      }

      this.initialized = true;
      logger.info('Memory manager initialized');
    } catch (error) {
      logger.error('Failed to initialize memory manager', { error });
      throw error;
    }
  }

  /**
   * Initialize Qdrant collection
   */
  private async initializeQdrantCollection(): Promise<void> {
    try {
      // Check if collection exists
      const collections = await this.qdrantClient.getCollections();
      const collectionExists = collections.collections.some(
        (col) => col.name === env.QDRANT_COLLECTION_NAME
      );

      if (!collectionExists) {
        // Create collection
        await this.qdrantClient.createCollection(env.QDRANT_COLLECTION_NAME, {
          vectors: {
            size: 1536, // OpenAI embedding size
            distance: 'Cosine',
          },
        });
        logger.info(`Qdrant collection created: ${env.QDRANT_COLLECTION_NAME}`);
      }

      // Initialize vector store
      this.vectorStore = await QdrantVectorStore.fromExistingCollection(
        this.embeddings,
        {
          url: env.QDRANT_URL,
          apiKey: env.QDRANT_API_KEY || undefined,
          collectionName: env.QDRANT_COLLECTION_NAME,
        }
      );

      logger.info('Qdrant vector store initialized');
    } catch (error) {
      logger.error('Failed to initialize Qdrant collection', { error });
      throw error;
    }
  }

  /**
   * Store a message exchange in short-term memory (Redis)
   */
  async storeShortTermMemory(
    userId: string,
    sessionId: string,
    userMessage: string,
    assistantResponse: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    try {
      const message: ChatMessage = {
        userId,
        sessionId,
        userMessage,
        assistantResponse,
        timestamp: Date.now(),
        metadata,
      };

      const key = `chat:${userId}:${sessionId}`;
      const serialized = JSON.stringify(message);

      // Store in Redis with TTL
      await this.redis.lpush(key, serialized);
      await this.redis.ltrim(key, 0, 99); // Keep last 100 messages
      await this.redis.expire(key, env.REDIS_TTL);

      logger.debug('Stored message in short-term memory', { userId, sessionId });
    } catch (error) {
      logger.error('Failed to store short-term memory', { error });
      throw error;
    }
  }

  /**
   * Get recent messages from short-term memory
   */
  async getRecentMessages(
    userId: string,
    sessionId: string,
    limit: number = 10
  ): Promise<ChatMessage[]> {
    try {
      const key = `chat:${userId}:${sessionId}`;
      const messages = await this.redis.lrange(key, 0, limit - 1);

      return messages
        .map((msg) => {
          try {
            return ChatMessageSchema.parse(JSON.parse(msg));
          } catch (error) {
            logger.warn('Failed to parse message from Redis', { error });
            return null;
          }
        })
        .filter((msg): msg is ChatMessage => msg !== null)
        .reverse(); // Return in chronological order
    } catch (error) {
      logger.error('Failed to get recent messages', { error });
      return [];
    }
  }

  /**
   * Store a document in long-term vector memory
   */
  async storeVectorMemory(
    content: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    if (!this.vectorStore || !env.OPENAI_API_KEY) {
      logger.warn('Vector store not available, skipping storage');
      return;
    }

    try {
      const document = new Document({
        pageContent: content,
        metadata: {
          ...metadata,
          timestamp: Date.now(),
        },
      });

      await this.vectorStore.addDocuments([document]);
      logger.info('Document stored in vector memory', { 
        contentLength: content.length,
        metadata,
      });
    } catch (error) {
      logger.error('Failed to store vector memory', { error });
      throw error;
    }
  }

  /**
   * Query vector memory for relevant documents
   */
  async queryVectorMemory(
    query: string,
    options: Partial<VectorQueryOptions> = {}
  ): Promise<Document[]> {
    if (!this.vectorStore || !env.OPENAI_API_KEY) {
      logger.warn('Vector store not available, returning empty results');
      return [];
    }

    try {
      const validatedOptions = VectorQueryOptionsSchema.parse(options);
      
      // Build filter in Qdrant format
      let qdrantFilter: any = undefined;
      
      // Collect all filter conditions
      const conditions: any[] = [];
      
      if (validatedOptions.role) {
        conditions.push({
          key: 'metadata.role',
          match: { value: validatedOptions.role }
        });
      }
      
      if (validatedOptions.filter) {
        Object.entries(validatedOptions.filter).forEach(([key, value]) => {
          conditions.push({
            key: `metadata.${key}`,
            match: { value }
          });
        });
      }
      
      // Build Qdrant filter structure if we have conditions
      if (conditions.length > 0) {
        qdrantFilter = {
          must: conditions
        };
      }

      // Perform similarity search
      const results = await this.vectorStore.similaritySearchWithScore(
        query,
        validatedOptions.limit || 5,
        qdrantFilter
      );

      // Filter by score threshold if provided
      const filteredResults = validatedOptions.scoreThreshold
        ? results.filter(([_, score]) => score >= validatedOptions.scoreThreshold!)
        : results;

      logger.info('Vector memory queried', {
        query: query.substring(0, 50),
        resultsCount: filteredResults.length,
        options: validatedOptions,
      });

      return filteredResults.map(([doc]) => doc);
    } catch (error) {
      logger.error('Failed to query vector memory', { error });
      return [];
    }
  }

  /**
   * Clear session memory
   */
  async clearSessionMemory(userId: string, sessionId: string): Promise<void> {
    try {
      const key = `chat:${userId}:${sessionId}`;
      await this.redis.del(key);
      logger.info('Session memory cleared', { userId, sessionId });
    } catch (error) {
      logger.error('Failed to clear session memory', { error });
      throw error;
    }
  }

  /**
   * Get memory statistics
   */
  async getMemoryStats(userId: string): Promise<{
    totalSessions: number;
    totalMessages: number;
    vectorDocuments?: number;
  }> {
    try {
      // Get all session keys for user
      const pattern = `chat:${userId}:*`;
      const keys = await this.redis.keys(pattern);
      
      let totalMessages = 0;
      for (const key of keys) {
        const count = await this.redis.llen(key);
        totalMessages += count;
      }

      // Get vector store stats if available
      let vectorDocuments: number | undefined;
      if (this.vectorStore && env.OPENAI_API_KEY) {
        try {
          const collectionInfo = await this.qdrantClient.getCollection(
            env.QDRANT_COLLECTION_NAME
          );
          vectorDocuments = collectionInfo.vectors_count || undefined;
        } catch (error) {
          logger.warn('Failed to get vector store stats', { error });
        }
      }

      return {
        totalSessions: keys.length,
        totalMessages,
        vectorDocuments,
      };
    } catch (error) {
      logger.error('Failed to get memory stats', { error });
      return {
        totalSessions: 0,
        totalMessages: 0,
      };
    }
  }

  /**
   * Close connections
   */
  async close(): Promise<void> {
    try {
      await this.redis.quit();
      logger.info('Memory manager connections closed');
    } catch (error) {
      logger.error('Error closing memory manager connections', { error });
    }
  }
} 