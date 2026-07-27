import { Router } from 'express';
import { CustomerService } from './customer.service';
import { requireAuth, authorize } from '@shared/middlewares/auth.middleware';
import { ApiError } from '@shared/errors/ApiError';
import { ALL_BUSINESS_ROLES } from '@shared/utils/roles';

const customerRouter: Router = Router();
const customerService = new CustomerService();

customerRouter.use(requireAuth, authorize(...ALL_BUSINESS_ROLES));

const getStoreId = (req: any): string => {
  const storeId = req.user?.storeId;
  if (!storeId) throw ApiError.forbidden('Usuario sin tienda asignada');
  return storeId;
};

customerRouter.get('/', async (req, res, next) => {
  try {
    const data = await customerService.list(getStoreId(req));
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

customerRouter.post('/', async (req, res, next) => {
  try {
    const data = await customerService.create({
      ...req.body,
      actorUserId: req.user?.id,
      ipAddress: req.ip,
      storeId: getStoreId(req),
    });
    res.status(201).json({ success: true, data });
  } catch (error) { next(error); }
});

customerRouter.put('/:id', async (req, res, next) => {
  try {
    const data = await customerService.update(req.params.id as string, {
      ...req.body,
      actorUserId: req.user?.id,
      ipAddress: req.ip,
      storeId: getStoreId(req),
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

export { customerRouter };
