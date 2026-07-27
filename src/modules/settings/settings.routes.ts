import { Router } from 'express';
import { SettingsService } from './settings.service';
import { requireAuth, authorize } from '@shared/middlewares/auth.middleware';
import { ApiError } from '@shared/errors/ApiError';
import { ALL_BUSINESS_ROLES } from '@shared/utils/roles';

const settingsRouter: Router = Router();
const settingsService = new SettingsService();

settingsRouter.use(requireAuth, authorize(...ALL_BUSINESS_ROLES));

const getStoreId = (req: any): string => {
  const storeId = req.user?.storeId;
  if (!storeId) throw ApiError.forbidden('Usuario sin tienda asignada');
  return storeId;
};

settingsRouter.get('/', async (req, res, next) => {
  try {
    const data = await settingsService.list(getStoreId(req));
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

settingsRouter.get('/:key', async (req, res, next) => {
  try {
    const data = await settingsService.getByKey(req.params.key as string, getStoreId(req));
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

settingsRouter.post('/', async (req, res, next) => {
  try {
    const data = await settingsService.create(req.body, getStoreId(req));
    res.status(201).json({ success: true, data });
  } catch (error) { next(error); }
});

settingsRouter.put('/:key', async (req, res, next) => {
  try {
    const data = await settingsService.update(req.params.key as string, req.body.value, getStoreId(req));
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

export { settingsRouter };
