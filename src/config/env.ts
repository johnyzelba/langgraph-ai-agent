import { z } from 'zod';
import dotenv from 'dotenv';
import { config } from 'dotenv-safe';
import path from 'path';

// Load environment variables
if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

// Use dotenv-safe to ensure all required variables are present
config({
  example: path.join(__dirname, '../../env.example'),
  path: path.join(__dirname, '../../.env'),
});

// Define the environment schema
const envSchema = z.object({
  // Server Configuration
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3000'),
  HOST: z.string().default('localhost'),

  // LLM Configuration
  GOOGLE_GENAI_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().optional(),

  // Redis Configuration
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.string().transform(Number).default('6379'),
  REDIS_PASSWORD: z.string().optional().default(''),
  REDIS_DB: z.string().transform(Number).default('0'),
  REDIS_TTL: z.string().transform(Number).default('3600'),

  // Qdrant Configuration
  QDRANT_URL: z.string().url().default('http://localhost:6333'),
  QDRANT_API_KEY: z.string().optional().default(''),
  QDRANT_COLLECTION_NAME: z.string().default('langgraph_vectors'),

  // Auth0 Configuration
  AUTH0_DOMAIN: z.string().min(1),
  AUTH0_CLIENT_ID: z.string().min(1),
  AUTH0_CLIENT_SECRET: z.string().min(1),
  AUTH0_AUDIENCE: z.string().url(),

  // JWT Configuration
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('24h'),

  // MCP Tool Servers
  MCP_BROWSER_SEARCH_URL: z.string().url(),
  MCP_SQL_QUERY_URL: z.string().url(),
  MCP_TIMEOUT: z.string().transform(Number).default('30000'),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.string().transform(Number).default('60000'),
  RATE_LIMIT_MAX_REQUESTS: z.string().transform(Number).default('100'),

  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  LOG_FILE: z.string().default('app.log'),

  // Security
  CORS_ORIGIN: z.string().default('http://localhost:3001'),
  HELMET_CSP_DIRECTIVES: z.string().optional(),

  // Telemetry
  ENABLE_TELEMETRY: z.string().transform((val) => val === 'true').default('true'),
  TELEMETRY_ENDPOINT: z.string().url().optional(),
});

// Parse and validate environment variables
const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Invalid environment variables:', parsedEnv.error.format());
  process.exit(1);
}

export const env = parsedEnv.data;

// Type for the environment variables
export type Env = z.infer<typeof envSchema>; 