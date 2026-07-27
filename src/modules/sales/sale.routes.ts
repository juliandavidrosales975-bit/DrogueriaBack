import { Router } from 'express';
import { SaleService } from './sale.service';
import { requireAuth, authorize } from '@shared/middlewares/auth.middleware';
import { ApiError } from '@shared/errors/ApiError';
import { ALL_BUSINESS_ROLES, OPERATOR_ROLES } from '@shared/utils/roles';

const saleRouter: Router = Router();
const saleService = new SaleService();

saleRouter.use(requireAuth, authorize(...ALL_BUSINESS_ROLES));

const getStoreId = (req: any): string => {
  const storeId = req.user?.storeId;
  if (!storeId) throw ApiError.forbidden('Usuario sin tienda asignada');
  return storeId;
};

saleRouter.get('/', async (req, res, next) => {
  try {
    // El Cajero/Vendedor solo puede ver sus propias ventas. El Administrador puede
    // filtrar por cualquier usuario de su tienda con ?userId=... (o ver todas si se omite).
    const isOperator = OPERATOR_ROLES.includes(req.user?.role as any);
    const userId = isOperator ? req.user!.id : (req.query.userId as string | undefined);

    const data = await saleService.list(getStoreId(req), userId);
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

saleRouter.post('/', async (req, res, next) => {
  try {
    const data = await saleService.create({
      ...req.body,
      actorUserId: req.user!.id,
      ipAddress: req.ip,
      storeId: getStoreId(req),
    });
    res.status(201).json({ success: true, data });
  } catch (error) { next(error); }
});

export { saleRouter };
