import { Router } from 'express';
import { DashboardService } from './dashboard.service';
import { requireAuth, authorize } from '@shared/middlewares/auth.middleware';
import { ApiError } from '@shared/errors/ApiError';
import { ALL_BUSINESS_ROLES } from '@shared/utils/roles';

const dashboardRouter: Router = Router();
const dashboardService = new DashboardService();

dashboardRouter.use(requireAuth, authorize(...ALL_BUSINESS_ROLES));

const getStoreId = (req: any): string => {
  const storeId = req.user?.storeId;
  if (!storeId) throw ApiError.forbidden('Usuario sin droguería asignada');
  return storeId;
};

dashboardRouter.get('/summary', async (req, res, next) => {
  try {
    const data = await dashboardService.summary(getStoreId(req));
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

/**
 * Rentabilidad de un rango: ?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Sin parámetros devuelve el día de hoy.
 */
dashboardRouter.get('/profit', async (req, res, next) => {
  try {
    const { from, to } = req.query as { from?: string; to?: string };
    const data = await dashboardService.profit(getStoreId(req), from, to);
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

/** Serie diaria de ventas / costo / utilidad: ?days=14 */
dashboardRouter.get('/profit/daily', async (req, res, next) => {
  try {
    const days = Number(req.query.days) || 14;
    const data = await dashboardService.profitDaily(getStoreId(req), days);
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

export { dashboardRouter };
