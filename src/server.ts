import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { createSupabaseClient, closeSupabaseClient } from '@core/database/connection';
import { env } from '@config/env';
import { errorHandler } from '@shared/middlewares/errorHandler';
import { logger } from '@shared/utils/logger';
import { startKeepAlivePing } from '@shared/utils/keepAlive';

const app = express();

// Middlewares de seguridad y utilidad
app.use(helmet());
app.use(cors({ origin: env.cors.origin, credentials: true }));
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging
if (env.nodeEnv === 'development') {
  app.use(morgan('dev'));
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.get('/api', (req, res) => {
  res.json({
    message: 'Droguería API',
    version: env.apiVersion,
    environment: env.nodeEnv,
  });
});

// Importar rutas
import { authRouter } from '@modules/auth/auth.routes';
import { productRouter } from '@modules/products/product.routes';
import { customerRouter } from '@modules/customers/customer.routes';
import { supplierRouter } from '@modules/suppliers/supplier.routes';
import { purchaseRouter } from '@modules/purchases/purchase.routes';
import { saleRouter } from '@modules/sales/sale.routes';
import { dashboardRouter } from '@modules/dashboard/dashboard.routes';
import { settingsRouter } from '@modules/settings/settings.routes';
import { auditRouter } from '@modules/audit/audit.routes';
import { usersRouter } from '@modules/users/users.routes';
import { storesRouter } from '@modules/stores/stores.routes';
import { cashRegisterRouter } from '@modules/cash-registers/cash-register.routes';

// Registrar rutas de módulos
app.use('/api/auth', authRouter);
app.use('/api/products', productRouter);
app.use('/api/customers', customerRouter);
app.use('/api/suppliers', supplierRouter);
app.use('/api/purchases', purchaseRouter);
app.use('/api/sales', saleRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/audit', auditRouter);
app.use('/api/users', usersRouter);
app.use('/api/stores', storesRouter);
app.use('/api/cash-registers', cashRegisterRouter);

// Error handler
app.use(errorHandler);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Ruta no encontrada',
  });
});

// Iniciar servidor
const startServer = async () => {
  try {
    // Conectar cliente Supabase
    createSupabaseClient();

    // Iniciar servidor HTTP
    const server = app.listen(env.port, () => {
      logger.info(`🚀 Servidor corriendo en puerto ${env.port}`);
      logger.info(`📝 Entorno: ${env.nodeEnv}`);
      logger.info(`🌐 http://localhost:${env.port}`);
      startKeepAlivePing();
    });

    // Graceful shutdown
    const shutdown = async () => {
      logger.info('⏹️  Cerrando servidor...');
      server.close(async () => {
        await closeSupabaseClient();
        logger.info('✅ Servidor cerrado correctamente');
        process.exit(0);
      });
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

  } catch (error) {
    logger.error('❌ Error al iniciar servidor:', error);
    process.exit(1);
  }
};

startServer();
