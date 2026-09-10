import { Request, Response, NextFunction } from 'express';
import { encryptEnvelope, decryptEnvelope, EncryptedEnvelope } from '../utils/crypto';

/**
 * Middleware de Cifrado Híbrido (RSA Asimétrico + Cifrado César).
 * - Descifra peticiones entrantes cifradas.
 * - Cifra automáticamente todas las respuestas JSON de la API para proteger los datos en tránsito.
 */
export function encryptionMiddleware(req: Request, res: Response, next: NextFunction) {
  // 1. Descifrar cuerpo de la petición si viene cifrado desde el cliente
  if (req.body && typeof req.body === 'object' && req.body.encrypted) {
    try {
      req.body = decryptEnvelope(req.body as EncryptedEnvelope);
    } catch (err) {
      console.error('Error descifrando payload entrante en middleware:', err);
    }
  }

  // 2. Omitir rutas de documentación y health check
  const isExcluded =
    req.path === '/health' ||
    req.path === '/api' ||
    req.path.startsWith('/api/docs') ||
    req.path.includes('/docs');

  if (isExcluded) {
    return next();
  }

  // 3. Interceptar res.json para cifrar la respuesta con RSA + César
  const originalJson = res.json.bind(res);
  res.json = function (body: any) {
    if (body && typeof body === 'object' && !body.encrypted) {
      try {
        const encryptedBody = encryptEnvelope(body);
        return originalJson(encryptedBody);
      } catch (err) {
        console.error('Error cifrando respuesta saliente:', err);
      }
    }
    return originalJson(body);
  };

  next();
}
