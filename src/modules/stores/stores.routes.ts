import { Router } from 'express';
import { StoresService } from './stores.service';
import { requireAuth, authorize } from '@shared/middlewares/auth.middleware';

const storesRouter: Router = Router();
const storesService = new StoresService();

const SUPER_ADMIN = 'Super Administrador';

storesRouter.use(requireAuth, authorize(SUPER_ADMIN));

// GET /api/stores — Listar todas las droguerías
storesRouter.get('/', async (_req, res, next) => {
  try {
    const data = await storesService.list();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// GET /api/stores/:id — Obtener droguería por ID
storesRouter.get('/:id', async (req, res, next) => {
  try {
    const data = await storesService.getById(req.params.id as string);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// POST /api/stores — Crear droguería
storesRouter.post('/', async (req, res, next) => {
  try {
    const data = await storesService.create(req.body);
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// PUT /api/stores/:id — Actualizar droguería
storesRouter.put('/:id', async (req, res, next) => {
  try {
    const data = await storesService.update(req.params.id as string, req.body);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/stores/:id — Eliminar droguería
storesRouter.delete('/:id', async (req, res, next) => {
  try {
    await storesService.delete(req.params.id as string);
    res.json({ success: true, message: 'Droguería eliminada correctamente' });
  } catch (error) {
    next(error);
  }
});

export { storesRouter };
