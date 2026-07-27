import { Router } from 'express';
import { ProductService } from './product.service';
import { CategoryService } from './category.service';
import { ProductUnitService } from './product-unit.service';
import { requireAuth, authorize } from '@shared/middlewares/auth.middleware';
import { ApiError } from '@shared/errors/ApiError';
import { ALL_BUSINESS_ROLES } from '@shared/utils/roles';

const productRouter: Router = Router();
const productService = new ProductService();
const categoryService = new CategoryService();
const productUnitService = new ProductUnitService();

productRouter.use(requireAuth, authorize(...ALL_BUSINESS_ROLES));

// Helper to extract storeId or throw
const getStoreId = (req: any): string => {
  const storeId = req.user?.storeId;
  if (!storeId) throw ApiError.forbidden('Usuario sin tienda asignada');
  return storeId;
};

productRouter.get('/categories', async (req, res, next) => {
  try {
    const data = await categoryService.list(getStoreId(req));
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

productRouter.post('/categories', async (req, res, next) => {
  try {
    const data = await categoryService.create(req.body, getStoreId(req));
    res.status(201).json({ success: true, data });
  } catch (error) { next(error); }
});

productRouter.get('/:productId/units', async (req, res, next) => {
  try {
    const data = await productUnitService.list(req.params.productId as string);
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

productRouter.post('/:productId/units', async (req, res, next) => {
  try {
    const data = await productUnitService.create({
      ...req.body,
      productId: req.params.productId as string,
      storeId: getStoreId(req),
    });
    res.status(201).json({ success: true, data });
  } catch (error) { next(error); }
});

productRouter.put('/units/:unitId', async (req, res, next) => {
  try {
    const data = await productUnitService.update(req.params.unitId as string, req.body, getStoreId(req));
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

productRouter.delete('/units/:unitId', async (req, res, next) => {
  try {
    await productUnitService.remove(req.params.unitId as string);
    res.json({ success: true, message: 'Presentación eliminada' });
  } catch (error) { next(error); }
});

productRouter.get('/', async (req, res, next) => {
  try {
    const storeId = getStoreId(req);
    console.log('[DEBUG] GET /api/products - User:', req.user?.email, 'StoreId:', storeId);
    const data = await productService.list(storeId);
    console.log('[DEBUG] GET /api/products - Found products count:', data.length);
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

productRouter.get('/low-stock', async (req, res, next) => {
  try {
    const data = await productService.lowStock(getStoreId(req));
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

productRouter.post('/', async (req, res, next) => {
  try {
    const data = await productService.create({
      ...req.body,
      actorUserId: req.user?.id,
      ipAddress: req.ip,
      storeId: getStoreId(req),
    });
    res.status(201).json({ success: true, data });
  } catch (error) { next(error); }
});

productRouter.put('/:id', async (req, res, next) => {
  try {
    const data = await productService.update(req.params.id as string, {
      ...req.body,
      actorUserId: req.user?.id,
      ipAddress: req.ip,
      storeId: getStoreId(req),
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

productRouter.put('/:id/stock', async (req, res, next) => {
  try {
    const data = await productService.adjustStock(req.params.id as string, Number(req.body.stock), {
      actorUserId: req.user?.id,
      ipAddress: req.ip,
      note: req.body.note,
      storeId: getStoreId(req),
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

// Borra TODO el inventario de la tienda (productos, ventas, compras). Solo Administrador.
productRouter.delete('/wipe-all', authorize('Administrador de Drogueria', 'Administrador de Tienda'), async (req, res, next) => {
  try {
    const data = await productService.wipeAll({
      actorUserId: req.user?.id,
      ipAddress: req.ip,
      storeId: getStoreId(req),
      confirmation: req.body?.confirmation,
    });
    res.json({ success: true, data, message: 'Inventario eliminado completamente' });
  } catch (error) { next(error); }
});

productRouter.delete('/:id', async (req, res, next) => {
  try {
    await productService.remove(req.params.id as string, {
      actorUserId: req.user?.id,
      ipAddress: req.ip,
      storeId: getStoreId(req),
    });
    res.json({ success: true, message: 'Producto eliminado' });
  } catch (error) { next(error); }
});

export { productRouter };
