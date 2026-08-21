import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '@config/env';
import { ApiError } from '@shared/errors/ApiError';
import { getSupabaseClient } from '@core/database/connection';

export type StoreType = 'PHARMACY' | 'STORE';
export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';

export interface JwtPayload {
  id: string;
  userId: string;
  email: string;
  role: string;
  storeId: string | null;
  storeName: string | null;
  storeType: StoreType | null;
  subscriptionStatus?: SubscriptionStatus | null;
  trialEndsAt?: string | null;
  daysRemaining?: number | null;
  isTrialExpired?: boolean;
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

/**
 * Middleware que verifica que el establecimiento tenga una suscripción o período de prueba activo.
 * Si el período expiró, bloquea operaciones de escritura (ventas, compras, creación de productos, etc.).
 */
export const requireActiveSubscription = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      return next(ApiError.unauthorized());
    }

    // Super Administrador tiene acceso total
    if (req.user.role === 'Super Administrador' || !req.user.storeId) {
      return next();
    }

    const client = getSupabaseClient() as any;
    const { data: store, error } = await client
      .from('stores')
      .select('is_active, subscription_status, trial_ends_at')
      .eq('id', req.user.storeId)
      .maybeSingle();

    if (error || !store) {
      return next(ApiError.notFound('Establecimiento no encontrado'));
    }

    if (store.is_active === false) {
      return next(ApiError.forbidden('El establecimiento se encuentra inactivo. Comunícate con soporte.'));
    }

    if (store.subscription_status === 'ACTIVE') {
      return next();
    }

    if (store.subscription_status === 'EXPIRED' || store.subscription_status === 'SUSPENDED') {
      return next(ApiError.forbidden('Tu período de prueba ha finalizado. El sistema está en modo solo lectura. Comunícate con soporte para habilitar el acceso completo.'));
    }

    if (store.subscription_status === 'TRIAL' && store.trial_ends_at) {
      const isExpired = new Date(store.trial_ends_at).getTime() < Date.now();
      if (isExpired) {
        return next(ApiError.forbidden('Tu período de prueba ha finalizado. El sistema está en modo solo lectura. Comunícate con soporte para habilitar el acceso completo.'));
      }
    }

    next();
  } catch (err) {
    next(err);
  }
};
