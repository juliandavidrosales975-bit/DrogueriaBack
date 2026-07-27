import { Router } from 'express';
import { CashRegisterService } from './cash-register.service';
import { requireAuth, authorize } from '@shared/middlewares/auth.middleware';
import { ApiError } from '@shared/errors/ApiError';
import { ALL_BUSINESS_ROLES, OPERATOR_ROLES } from '@shared/utils/roles';

const cashRegisterRouter: Router = Router();
const cashRegisterService = new CashRegisterService();

cashRegisterRouter.use(requireAuth, authorize(...ALL_BUSINESS_ROLES));

const getStoreId = (req: any): string => {
  const storeId = req.user?.storeId;
  if (!storeId) throw ApiError.forbidden('Usuario sin tienda asignada');
  return storeId;
};

cashRegisterRouter.get('/current', async (req, res, next) => {
  try {
    const data = await cashRegisterService.getCurrent(getStoreId(req));
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

cashRegisterRouter.get('/history', async (req, res, next) => {
  try {
    // El Cajero/Vendedor solo puede ver sus propios turnos. El Administrador puede
    // filtrar por cualquier usuario de su tienda con ?userId=... (o ver todos si se omite).
    const isOperator = OPERATOR_ROLES.includes(req.user?.role as any);
    const userId = isOperator ? req.user!.id : (req.query.userId as string | undefined);

    const data = await cashRegisterService.history(getStoreId(req), userId);
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

cashRegisterRouter.post('/open', async (req, res, next) => {
  try {
    const data = await cashRegisterService.open({
      storeId: getStoreId(req),
      actorUserId: req.user!.id,
      ipAddress: req.ip,
      openingAmount: Number(req.body.openingAmount),
      note: req.body.note,
    });
    res.status(201).json({ success: true, data });
  } catch (error) { next(error); }
});

cashRegisterRouter.post('/close', async (req, res, next) => {
  try {
    const data = await cashRegisterService.close({
      storeId: getStoreId(req),
      actorUserId: req.user!.id,
      ipAddress: req.ip,
      closingAmount: Number(req.body.closingAmount),
      note: req.body.note,
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

export { cashRegisterRouter };
