import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { createLogger } from '../utils/logger';

const logger = createLogger('auth-middleware');

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email?: string;
        role?: string;
        permissions?: string[];
      };
    }
  }
}

// JWT payload interface
interface JWTPayload {
  sub: string;
  email?: string;
  role?: string;
  permissions?: string[];
  iat?: number;
  exp?: number;
  aud?: string | string[];
  iss?: string;
}

/**
 * Verify JWT token
 */
export const verifyToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      res.status(401).json({ error: 'No authorization header' });
      return;
    }

    const [bearer, token] = authHeader.split(' ');
    if (bearer !== 'Bearer' || !token) {
      res.status(401).json({ error: 'Invalid authorization format' });
      return;
    }

    // Verify token
    const decoded = jwt.verify(token, env.JWT_SECRET) as JWTPayload;

    // Check token expiration
    if (decoded.exp && decoded.exp * 1000 < Date.now()) {
      res.status(401).json({ error: 'Token expired' });
      return;
    }

    // Check audience if configured
    if (env.AUTH0_AUDIENCE && decoded.aud !== env.AUTH0_AUDIENCE) {
      res.status(401).json({ error: 'Invalid token audience' });
      return;
    }

    // Attach user to request
    req.user = {
      userId: decoded.sub,
      email: decoded.email,
      role: decoded.role,
      permissions: decoded.permissions,
    };

    logger.debug('Token verified', { userId: decoded.sub });
    next();
  } catch (error) {
    logger.error('Token verification failed', { error });
    
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Token expired' });
    } else if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: 'Invalid token' });
    } else {
      res.status(500).json({ error: 'Authentication error' });
    }
  }
};

/**
 * Check if user has required role
 */
export const requireRole = (requiredRole: string) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (req.user.role !== requiredRole) {
      logger.warn('Access denied - insufficient role', {
        userId: req.user.userId,
        userRole: req.user.role,
        requiredRole,
      });
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
};

/**
 * Check if user has required permissions
 */
export const requirePermissions = (requiredPermissions: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const userPermissions = req.user.permissions || [];
    const hasAllPermissions = requiredPermissions.every(perm => 
      userPermissions.includes(perm)
    );

    if (!hasAllPermissions) {
      logger.warn('Access denied - insufficient permissions', {
        userId: req.user.userId,
        userPermissions,
        requiredPermissions,
      });
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
};

/**
 * Optional authentication - doesn't fail if no token
 */
export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    // No token provided, continue without user
    next();
    return;
  }

  // If token is provided, verify it
  verifyToken(req, res, next);
}; 