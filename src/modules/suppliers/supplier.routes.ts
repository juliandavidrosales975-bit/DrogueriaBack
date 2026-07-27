import { Router } from 'express';
import { SupplierService } from './supplier.service';
import { requireAuth, authorize } from '@shared/middlewares/auth.middleware';
import { ApiError } from '@shared/errors/ApiError';
import { ALL_BUSINESS_ROLES } from '@shared/utils/roles';

const supplierRouter: Router = Router();
const supplierService = new SupplierService();

supplierRouter.use(requireAuth, authorize(...ALL_BUSINESS_ROLES));

const getStoreId = (req: any): string => {
  const storeId = req.user?.storeId;
  if (!storeId) throw ApiError.forbidden('Usuario sin tienda asignada');
  return storeId;
};

supplierRouter.get('/', async (req, res, next) => {
  try {
    const data = await supplierService.list(getStoreId(req));
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

supplierRouter.post('/', async (req, res, next) => {
  try {
    const data = await supplierService.create({
      ...req.body,
      actorUserId: req.user?.id,
      ipAddress: req.ip,
      storeId: getStoreId(req),
    });
    res.status(201).json({ success: true, data });
  } catch (error) { next(error); }
});

supplierRouter.put('/:id', async (req, res, next) => {
  try {
    const data = await supplierService.update(req.params.id as string, {
      ...req.body,
      actorUserId: req.user?.id,
      ipAddress: req.ip,
      storeId: getStoreId(req),
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

export { supplierRouter };
