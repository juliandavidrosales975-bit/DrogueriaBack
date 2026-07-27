import { Router } from 'express';
import { UsersService } from './users.service';
import { requireAuth, authorize } from '@shared/middlewares/auth.middleware';
import { SUPER_ADMIN, PHARMACY_ADMIN, STORE_ADMIN } from '@shared/utils/roles';

const usersRouter: Router = Router();
const usersService = new UsersService();

const ADMIN_ROLES = [SUPER_ADMIN, PHARMACY_ADMIN, STORE_ADMIN];

// GET /api/users/store/staff — Listar el personal (cajeros, vendedores, etc.) de la propia tienda
// Usado por el Administrador de Drogueria o Administrador de Tienda para filtrar reportes por empleado.
usersRouter.get('/store/staff', requireAuth, authorize(PHARMACY_ADMIN, STORE_ADMIN), async (req, res, next) => {
  try {
    const storeId = req.user?.storeId;
    if (!storeId) {
      return res.json({ success: true, data: [] });
    }
    const data = await usersService.listByStore(storeId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// GET /api/users — Listar usuarios (Super Admin ve todos, Admin de tienda/droguería ve los de su establecimiento)
usersRouter.get('/', requireAuth, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const data = await usersService.list(req.user);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// GET /api/users/roles — Obtener roles disponibles
usersRouter.get('/roles', requireAuth, authorize(...ADMIN_ROLES), async (_req, res, next) => {
  try {
    const data = await usersService.getRoles();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// GET /api/users/:id — Obtener usuario por ID
usersRouter.get('/:id', requireAuth, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const data = await usersService.getById(req.params.id as string, req.user);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// POST /api/users — Crear usuario
usersRouter.post('/', requireAuth, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const data = await usersService.create({
      ...req.body,
      actorUser: req.user,
      actorUserId: req.user?.id,
      ipAddress: req.ip,
    });
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// PUT /api/users/:id — Actualizar usuario
usersRouter.put('/:id', requireAuth, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const data = await usersService.update(req.params.id as string, {
      ...req.body,
      actorUser: req.user,
      actorUserId: req.user?.id,
      ipAddress: req.ip,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/users/:id — Eliminar usuario
usersRouter.delete('/:id', requireAuth, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    await usersService.delete(req.params.id as string, req.user, req.ip);
    res.json({ success: true, message: 'Usuario eliminado correctamente' });
  } catch (error) {
    next(error);
  }
});

export { usersRouter };

