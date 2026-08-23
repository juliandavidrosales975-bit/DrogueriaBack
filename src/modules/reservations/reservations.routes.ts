import { Router } from 'express';
import { ReservationsService } from './reservations.service';
import { requireAuth, authorize } from '@shared/middlewares/auth.middleware';
import { ApiError } from '@shared/errors/ApiError';
import { ALL_BUSINESS_ROLES } from '@shared/utils/roles';

const reservationsRouter: Router = Router();
const reservationsService = new ReservationsService();

reservationsRouter.use(requireAuth, authorize(...ALL_BUSINESS_ROLES));

const getStoreId = (req: any): string => {
  const storeId = req.user?.storeId;
  if (!storeId) throw ApiError.forbidden('Usuario sin tienda asignada');
  return storeId;
};

const getUserId = (req: any): string => {
  const userId = req.user?.id;
  if (!userId) throw ApiError.unauthorized('Usuario no autenticado');
  return userId;
};

// Listar reservas con filtros
reservationsRouter.get('/', async (req, res, next) => {
  try {
    const { date, status, search } = req.query;
    const data = await reservationsService.list(getStoreId(req), {
      date: date ? String(date) : undefined,
      status: status ? String(status) : undefined,
      search: search ? String(search) : undefined,
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

// Obtener una reserva por ID
reservationsRouter.get('/:id', async (req, res, next) => {
  try {
    const data = await reservationsService.getById(req.params.id as string, getStoreId(req));
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

// Crear nueva reserva con abono inicial opcional
reservationsRouter.post('/', async (req, res, next) => {
  try {
    const data = await reservationsService.create({
      input: req.body,
      storeId: getStoreId(req),
      userId: getUserId(req),
      ipAddress: req.ip,
    });
    res.status(201).json({ success: true, data });
  } catch (error) { next(error); }
});

// Registrar un abono adicional a una reserva existente
reservationsRouter.post('/:id/advances', async (req, res, next) => {
  try {
    const data = await reservationsService.addAdvance({
      reservationId: req.params.id as string,
      input: req.body,
      storeId: getStoreId(req),
      userId: getUserId(req),
      ipAddress: req.ip,
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

// Completar / liquidar una reserva (cuando se factura en el POS)
reservationsRouter.patch('/:id/complete', async (req, res, next) => {
  try {
    const data = await reservationsService.complete({
      reservationId: req.params.id as string,
      saleId: req.body.saleId,
      storeId: getStoreId(req),
      userId: getUserId(req),
      ipAddress: req.ip,
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

// Cancelar una reserva
reservationsRouter.patch('/:id/cancel', async (req, res, next) => {
  try {
    const data = await reservationsService.cancel({
      reservationId: req.params.id as string,
      storeId: getStoreId(req),
      userId: getUserId(req),
      ipAddress: req.ip,
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

// Eliminar permanentemente una reserva
reservationsRouter.delete('/:id', async (req, res, next) => {
  try {
    const data = await reservationsService.delete({
      reservationId: req.params.id as string,
      storeId: getStoreId(req),
      userId: getUserId(req),
      ipAddress: req.ip,
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

export { reservationsRouter };
