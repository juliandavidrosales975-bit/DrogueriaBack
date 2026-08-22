import { getSupabaseClient, throwIfError } from '@core/database/connection';
import { generateId } from '@shared/utils/cuid';

export type ReservationStatus = 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';

export type ReservationAdvance = {
  id: string;
  storeId: string;
  reservationId: string;
  userId: string;
  userName?: string | null;
  cashRegisterId?: string | null;
  amount: number;
  paymentMethod: string;
  notes?: string | null;
  createdAt: string;
};

export type CourtReservation = {
  id: string;
  storeId: string;
  customerId?: string | null;
  customerName: string;
  customerPhone?: string | null;
  courtName: string;
  reservationDate: string;
  startTime: string;
  endTime: string;
  totalPrice: number;
  status: ReservationStatus;
  notes?: string | null;
  saleId?: string | null;
  createdByUserId: string;
  createdByName?: string | null;
  createdAt: string;
  updatedAt: string;
  advances: ReservationAdvance[];
  totalAdvanced: number;
  pendingBalance: number;
};

export type CreateReservationInput = {
  customerId?: string | null;
  customerName: string;
  customerPhone?: string | null;
  courtName: string;
  reservationDate: string;
  startTime: string;
  endTime: string;
  totalPrice: number;
  notes?: string | null;
  initialAdvance?: {
    amount: number;
    paymentMethod: string;
    notes?: string | null;
  } | null;
};

export type AddAdvanceInput = {
  amount: number;
  paymentMethod: string;
  notes?: string | null;
};

export type ReservationFilters = {
  date?: string;
  status?: string;
  search?: string;
};

const mapAdvance = (row: any): ReservationAdvance => ({
  id: row.id,
  storeId: row.store_id,
  reservationId: row.reservation_id,
  userId: row.user_id,
  userName: row.users?.full_name ?? null,
  cashRegisterId: row.cash_register_id,
  amount: Number(row.amount),
  paymentMethod: row.payment_method,
  notes: row.notes,
  createdAt: row.created_at,
});

const mapReservation = (row: any): CourtReservation => {
  const advances = (row.reservation_advances || []).map(mapAdvance);
  const totalAdvanced = advances.reduce((sum: number, a: ReservationAdvance) => sum + a.amount, 0);
  const totalPrice = Number(row.total_price);
  const pendingBalance = Math.max(0, totalPrice - totalAdvanced);

  return {
    id: row.id,
    storeId: row.store_id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    courtName: row.court_name,
    reservationDate: row.reservation_date,
    startTime: row.start_time,
    endTime: row.end_time,
    totalPrice,
    status: row.status as ReservationStatus,
    notes: row.notes,
    saleId: row.sale_id,
    createdByUserId: row.created_by_user_id,
    createdByName: row.created_by?.full_name ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    advances,
    totalAdvanced,
    pendingBalance,
  };
};

export class ReservationsRepository {
  private get client() {
    return getSupabaseClient();
  }

  async findAll(storeId: string, filters?: { date?: string; status?: string; search?: string }): Promise<CourtReservation[]> {
    let query = this.client
      .from('court_reservations')
      .select('*, created_by:users!court_reservations_created_by_user_id_fkey(full_name), reservation_advances(*, users(full_name))')
      .eq('store_id', storeId);

    if (filters?.date) {
      query = query.eq('reservation_date', filters.date);
    }

    if (filters?.status && filters.status !== 'ALL') {
      query = query.eq('status', filters.status);
    }

    if (filters?.search && filters.search.trim()) {
      const s = filters.search.trim().toLowerCase();
      query = query.or(`customer_name.ilike.%${s}%,customer_phone.ilike.%${s}%,court_name.ilike.%${s}%`);
    }

    const { data, error } = await query
      .order('reservation_date', { ascending: true })
      .order('start_time', { ascending: true });

    throwIfError(error);
    return (data || []).map(mapReservation);
  }

  async findById(id: string, storeId: string): Promise<CourtReservation | null> {
    const { data, error } = await this.client
      .from('court_reservations')
      .select('*, created_by:users!court_reservations_created_by_user_id_fkey(full_name), reservation_advances(*, users(full_name))')
      .eq('id', id)
      .eq('store_id', storeId)
      .maybeSingle();

    throwIfError(error);
    return data ? mapReservation(data) : null;
  }

  async create(
    input: CreateReservationInput,
    storeId: string,
    userId: string,
    cashRegisterId?: string | null
  ): Promise<CourtReservation> {
    const reservationId = generateId();

    const { error: resError } = await this.client
      .from('court_reservations')
      .insert({
        id: reservationId,
        store_id: storeId,
        customer_id: input.customerId || null,
        customer_name: input.customerName,
        customer_phone: input.customerPhone || null,
        court_name: input.courtName,
        reservation_date: input.reservationDate,
        start_time: input.startTime,
        end_time: input.endTime,
        total_price: input.totalPrice,
        status: 'PENDING',
        notes: input.notes || null,
        created_by_user_id: userId,
      });

    throwIfError(resError);

    if (input.initialAdvance && input.initialAdvance.amount > 0) {
      const advanceId = generateId();
      const { error: advError } = await this.client
        .from('reservation_advances')
        .insert({
          id: advanceId,
          store_id: storeId,
          reservation_id: reservationId,
          user_id: userId,
          cash_register_id: cashRegisterId || null,
          amount: input.initialAdvance.amount,
          payment_method: input.initialAdvance.paymentMethod || 'CASH',
          notes: input.initialAdvance.notes || 'Abono inicial',
        });
      throwIfError(advError);
    }

    const created = await this.findById(reservationId, storeId);
    if (!created) throw new Error('Error al recuperar la reserva recién creada');
    return created;
  }

  async addAdvance(
    reservationId: string,
    input: AddAdvanceInput,
    storeId: string,
    userId: string,
    cashRegisterId?: string | null
  ): Promise<ReservationAdvance> {
    const advanceId = generateId();
    const { data, error } = await this.client
      .from('reservation_advances')
      .insert({
        id: advanceId,
        store_id: storeId,
        reservation_id: reservationId,
        user_id: userId,
        cash_register_id: cashRegisterId || null,
        amount: input.amount,
        payment_method: input.paymentMethod || 'CASH',
        notes: input.notes || null,
      })
      .select('*, users(full_name)')
      .single();

    throwIfError(error);
    return mapAdvance(data);
  }

  async updateStatus(
    reservationId: string,
    status: ReservationStatus,
    storeId: string,
    saleId?: string | null
  ): Promise<void> {
    const updatePayload: any = {
      status,
      updated_at: new Date().toISOString(),
    };
    if (saleId !== undefined) {
      updatePayload.sale_id = saleId;
    }

    const { error } = await this.client
      .from('court_reservations')
      .update(updatePayload)
      .eq('id', reservationId)
      .eq('store_id', storeId);

    throwIfError(error);
  }

  async cancel(reservationId: string, storeId: string): Promise<void> {
    const { error } = await this.client
      .from('court_reservations')
      .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
      .eq('id', reservationId)
      .eq('store_id', storeId);

    throwIfError(error);
  }
}
