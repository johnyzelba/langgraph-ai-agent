import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import Redis from 'ioredis';
import { env } from '../config/env';
import { createLogger } from '../utils/logger';

const logger = createLogger('rate-limit');

// Create Redis client for rate limiting
const redisClient = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD,
  db: env.REDIS_DB + 1, // Use a different DB for rate limiting
});

/**
 * Create a rate limiter with custom configuration
 */
export const createRateLimiter = (options: {
  windowMs?: number;
  max?: number;
  message?: string;
  keyGenerator?: (req: any) => string;
} = {}) => {
  const {
    windowMs = env.RATE_LIMIT_WINDOW_MS,
    max = env.RATE_LIMIT_MAX_REQUESTS,
    message = 'Too many requests from this IP, please try again later.',
    keyGenerator,
  } = options;

  return rateLimit({
    store: new RedisStore({
      // @ts-expect-error - RedisStore types may be incorrect
      sendCommand: (...args: string[]) => redisClient.call(...args),
      prefix: 'rl:',
    }),
    windowMs,
    max,
    message,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: keyGenerator || ((req) => {
      // Use user ID if authenticated, otherwise use IP
      return req.user?.userId || req.ip || 'unknown';
    }),
    handler: (req, res) => {
      logger.warn('Rate limit exceeded', {
        ip: req.ip,
        userId: req.user?.userId,
        path: req.path,
      });
      res.status(429).json({
        error: message,
        retryAfter: Math.ceil(windowMs / 1000),
      });
    },
  });
};

// Pre-configured rate limiters
export const generalRateLimiter = createRateLimiter();

export const strictRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: 'Too many requests, please slow down.',
});

export const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: 'Too many authentication attempts, please try again later.',
  keyGenerator: (req) => req.ip, // Always use IP for auth endpoints
}); 