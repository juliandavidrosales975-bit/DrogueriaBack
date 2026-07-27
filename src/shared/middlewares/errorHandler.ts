import { Request, Response, NextFunction } from 'express';
import { ApiError } from '@shared/errors/ApiError';
import { ZodError } from 'zod';
import { env } from '@config/env';

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      errors: err.errors,
    });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      message: 'Error de validación',
      errors: err.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    });
  }

  // Database errors
  if ('code' in err) {
    const dbError = err as any;
    
    if (dbError.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        message: 'El registro ya existe',
      });
    }

    if (dbError.code === 'ER_NO_REFERENCED_ROW_2') {
      return res.status(400).json({
        success: false,
        message: 'Referencia inválida',
      });
    }
  }

  // Log error
  console.error('❌ Error:', err);

  // Generic error
  res.status(500).json({
    success: false,
    message: env.nodeEnv === 'development' 
      ? err.message 
      : 'Error interno del servidor',
    ...(env.nodeEnv === 'development' && { stack: err.stack }),
  });
};
