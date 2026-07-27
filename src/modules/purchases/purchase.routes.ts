import { Router } from 'express';
import { PurchaseService } from './purchase.service';
import { requireAuth, authorize } from '@shared/middlewares/auth.middleware';
import { ApiError } from '@shared/errors/ApiError';
import { ALL_BUSINESS_ROLES } from '@shared/utils/roles';

const purchaseRouter: Router = Router();
const purchaseService = new PurchaseService();

purchaseRouter.use(requireAuth, authorize(...ALL_BUSINESS_ROLES));

const getStoreId = (req: any): string => {
  const storeId = req.user?.storeId;
  if (!storeId) throw ApiError.forbidden('Usuario sin tienda asignada');
  return storeId;
};

purchaseRouter.get('/', async (req, res, next) => {
  try {
    const data = await purchaseService.list(getStoreId(req));
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

purchaseRouter.post('/', async (req, res, next) => {
  try {
    const data = await purchaseService.create({
      ...req.body,
      actorUserId: req.user!.id,
      ipAddress: req.ip,
      storeId: getStoreId(req),
    });
    res.status(201).json({ success: true, data });
  } catch (error) { next(error); }
});

// Edita una compra ya registrada (ítems, cantidades, costos y precio de venta).
// El ajuste de inventario y la validación de stock los hace la RPC update_purchase.
purchaseRouter.put('/:id', async (req, res, next) => {
  try {
    const data = await purchaseService.update({
      ...req.body,
      purchaseId: req.params.id as string,
      actorUserId: req.user!.id,
      ipAddress: req.ip,
      storeId: getStoreId(req),
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

purchaseRouter.get('/outstanding-by-supplier', async (req, res, next) => {
  try {
    const data = await purchaseService.outstandingBySupplier(getStoreId(req));
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

purchaseRouter.post('/:id/payments', async (req, res, next) => {
  try {
    const data = await purchaseService.registerPayment({
      purchaseId: req.params.id as string,
      amount: Number(req.body.amount),
      paymentMethod: req.body.paymentMethod,
      note: req.body.note,
      actorUserId: req.user!.id,
      ipAddress: req.ip,
      storeId: getStoreId(req),
    });
    res.status(201).json({ success: true, data });
  } catch (error) { next(error); }
});

export { purchaseRouter };
