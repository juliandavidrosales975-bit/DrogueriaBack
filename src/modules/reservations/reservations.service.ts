import {
  ReservationsRepository,
  CreateReservationInput,
  AddAdvanceInput,
  ReservationFilters,
} from './reservations.repository';
import { CashRegisterService } from '../cash-registers/cash-register.service';
import { ApiError } from '@shared/errors/ApiError';
import { createAuditLog } from '@shared/utils/audit';

export class ReservationsService {
  private repo = new ReservationsRepository();
  private cashRegisterService = new CashRegisterService();

  async list(storeId: string, filters?: ReservationFilters) {
    return this.repo.findAll(storeId, filters);
  }

  async getById(id: string, storeId: string) {
    const reservation = await this.repo.findById(id, storeId);
    if (!reservation) {
      throw ApiError.notFound('Reserva no encontrada');
    }
    return reservation;
  }

  async create(params: {
    input: CreateReservationInput;
    storeId: string;
    userId: string;
    ipAddress?: string;
  }) {
    const { input, storeId, userId, ipAddress } = params;

    if (!input.customerName?.trim()) {
      throw ApiError.badRequest('El nombre del cliente es obligatorio');
    }
    if (!input.courtName?.trim()) {
      throw ApiError.badRequest('El nombre o número de cancha es obligatorio');
    }
    if (!input.reservationDate) {
      throw ApiError.badRequest('La fecha de la reserva es obligatoria');
    }
    if (!input.startTime || !input.endTime) {
      throw ApiError.badRequest('Las horas de inicio y fin son obligatorias');
    }
    if (input.totalPrice <= 0) {
      throw ApiError.badRequest('El valor total debe ser mayor a cero');
    }

    let cashRegisterId: string | null = null;
    if (input.initialAdvance && input.initialAdvance.amount > 0) {
      if (input.initialAdvance.amount > input.totalPrice) {
        throw ApiError.badRequest('El abono inicial no puede superar el valor total de la reserva');
      }
      const currentRegister = await this.cashRegisterService.getCurrent(storeId);
      cashRegisterId = currentRegister?.id || null;
    }

    const reservation = await this.repo.create(input, storeId, userId, cashRegisterId);

    await createAuditLog({
      entityType: 'RESERVATION',
      entityId: reservation.id,
      action: 'CREATE',
      description: `Creación de reserva para ${input.customerName} en ${input.courtName}`,
      metadata: {
        storeId,
        customerName: input.customerName,
        courtName: input.courtName,
        reservationDate: input.reservationDate,
        totalPrice: input.totalPrice,
        initialAdvance: input.initialAdvance?.amount || 0,
      },
      userId,
      ipAddress,
    });

    return reservation;
  }

  async addAdvance(params: {
    reservationId: string;
    input: AddAdvanceInput;
    storeId: string;
    userId: string;
    ipAddress?: string;
  }) {
    const { reservationId, input, storeId, userId, ipAddress } = params;

    const reservation = await this.getById(reservationId, storeId);
    if (reservation.status === 'COMPLETED') {
      throw ApiError.badRequest('Esta reserva ya fue completada');
    }
    if (reservation.status === 'CANCELLED') {
      throw ApiError.badRequest('Esta reserva está cancelada');
    }

    if (input.amount <= 0) {
      throw ApiError.badRequest('El monto del abono debe ser mayor a cero');
    }

    if (input.amount > reservation.pendingBalance) {
      throw ApiError.badRequest(`El abono ($${input.amount}) no puede ser mayor al saldo pendiente ($${reservation.pendingBalance})`);
    }

    const currentRegister = await this.cashRegisterService.getCurrent(storeId);
    const cashRegisterId = currentRegister?.id || null;

    const advance = await this.repo.addAdvance(reservationId, input, storeId, userId, cashRegisterId);

    await createAuditLog({
      entityType: 'RESERVATION_ADVANCE',
      entityId: advance.id,
      action: 'CREATE',
      description: `Abono de $${input.amount} para reserva ${reservationId}`,
      metadata: {
        storeId,
        reservationId,
        amount: input.amount,
        paymentMethod: input.paymentMethod,
      },
      userId,
      ipAddress,
    });

    // Devolver la reserva actualizada
    return this.getById(reservationId, storeId);
  }

  async complete(params: {
    reservationId: string;
    saleId: string;
    storeId: string;
    userId: string;
    ipAddress?: string;
  }) {
    const { reservationId, saleId, storeId, userId, ipAddress } = params;
    await this.repo.updateStatus(reservationId, 'COMPLETED', storeId, saleId);

    await createAuditLog({
      entityType: 'RESERVATION',
      entityId: reservationId,
      action: 'UPDATE',
      description: `Reserva ${reservationId} liquidada con venta #${saleId}`,
      metadata: {
        storeId,
        status: 'COMPLETED',
        saleId,
      },
      userId,
      ipAddress,
    });

    return this.getById(reservationId, storeId);
  }

  async cancel(params: {
    reservationId: string;
    storeId: string;
    userId: string;
    ipAddress?: string;
  }) {
    const { reservationId, storeId, userId, ipAddress } = params;
    const reservation = await this.getById(reservationId, storeId);
    if (reservation.status === 'COMPLETED') {
      throw ApiError.badRequest('No se puede cancelar una reserva ya completada');
    }

    await this.repo.cancel(reservationId, storeId);

    await createAuditLog({
      entityType: 'RESERVATION',
      entityId: reservationId,
      action: 'CANCEL',
      description: `Cancelación de reserva ${reservationId}`,
      metadata: {
        storeId,
        status: 'CANCELLED',
      },
      userId,
      ipAddress,
    });

    return { success: true };
  }

  async delete(params: {
    reservationId: string;
    storeId: string;
    userId: string;
    ipAddress?: string;
  }) {
    const { reservationId, storeId, userId, ipAddress } = params;
    const reservation = await this.getById(reservationId, storeId);

    await this.repo.delete(reservationId, storeId);

    await createAuditLog({
      entityType: 'RESERVATION',
      entityId: reservationId,
      action: 'DELETE',
      description: `Eliminación permanente de reserva de ${reservation.customerName} (${reservation.courtName})`,
      metadata: {
        storeId,
        customerName: reservation.customerName,
        courtName: reservation.courtName,
        reservationDate: reservation.reservationDate,
        totalPrice: reservation.totalPrice,
      },
      userId,
      ipAddress,
    });

    return { success: true };
  }
}
