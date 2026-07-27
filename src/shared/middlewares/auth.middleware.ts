import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '@config/env';
import { ApiError } from '@shared/errors/ApiError';

export type StoreType = 'PHARMACY' | 'STORE';

export interface JwtPayload {
  id: string;
  userId: string;
  email: string;
  role: string;
  storeId: string | null;
  storeName: string | null;
  storeType: StoreType | null;
  permissions?: string[] | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw ApiError.unauthorized('Token no proporcionado');
    }

    const token = authHeader.substring(7);

    const decoded = jwt.verify(token, env.jwt.secret) as Omit<JwtPayload, 'id'>;
    // El token firma "userId"; normalizamos también como "id" para el resto de la app
    req.user = { ...decoded, id: decoded.userId };

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      next(ApiError.unauthorized('Token inválido'));
    } else if (error instanceof jwt.TokenExpiredError) {
      next(ApiError.unauthorized('Token expirado'));
    } else {
      next(error);
    }
  }
};

export const authorize = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(ApiError.unauthorized());
    }

    if (roles.length && !roles.includes(req.user.role)) {
      return next(ApiError.forbidden('No tienes permisos para esta acción'));
    }

    next();
  };
};
