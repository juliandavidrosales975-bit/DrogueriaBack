import { env } from '@config/env';
import { logger } from './logger';

/**
 * Mantiene despierto el servicio en hostings gratuitos (Render, Railway, etc.)
 * que "duermen" la instancia tras un período de inactividad y tardan decenas de
 * segundos en volver a responder (lo que se percibe como que "se cae").
 *
 * Estrategia: el propio backend se hace un ping periódico a su endpoint /health.
 * No reemplaza un monitor externo (que sería más confiable porque sigue
 * funcionando incluso si el proceso llega a caerse), pero cubre el caso más
 * común de "nadie usó la app en un rato y se duerme".
 */
export function startKeepAlivePing(): void {
  if (!env.keepAlive.enabled) {
    logger.info('⏸️  Keep-alive deshabilitado (KEEP_ALIVE_ENABLED=false o entorno no productivo)');
    return;
  }

  if (!env.keepAlive.url) {
    logger.warn(
      '⚠️  Keep-alive habilitado pero no se configuró KEEP_ALIVE_URL (ni RENDER_EXTERNAL_URL). ' +
        'Define KEEP_ALIVE_URL con la URL pública del backend para que el ping funcione.',
    );
    return;
  }

  const pingUrl = `${env.keepAlive.url.replace(/\/+$/, '')}/health`;
  const intervalMs = Math.max(1, env.keepAlive.intervalMinutes) * 60 * 1000;

  const ping = async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const response = await fetch(pingUrl, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        logger.warn(`⚠️  Keep-alive ping respondió con estado ${response.status}`);
      } else {
        logger.debug(`🔁 Keep-alive ping OK (${pingUrl})`);
      }
    } catch (error: any) {
      logger.warn(`⚠️  Keep-alive ping falló: ${error?.message || error}`);
    }
  };

  // Primer ping tras 1 minuto (para no competir con el arranque del servidor),
  // y luego cada `intervalMinutes` minutos indefinidamente.
  setTimeout(ping, 60 * 1000);
  setInterval(ping, intervalMs);

  logger.info(`🔁 Keep-alive activado: ping a ${pingUrl} cada ${env.keepAlive.intervalMinutes} min`);
}
