import { getSupabaseClient, throwIfError } from '@core/database/connection';
import { ApiError } from '@shared/errors/ApiError';
import { createAuditLog } from '@shared/utils/audit';
import { generateId } from '@shared/utils/cuid';

type OpenCashRegisterInput = {
  storeId: string;
  actorUserId: string;
  ipAddress?: string;
  openingAmount: number;
  note?: string;
};

type CloseCashRegisterInput = {
  storeId: string;
  actorUserId: string;
  ipAddress?: string;
  closingAmount: number;
  note?: string;
};

const mapRegister = (row: any) => ({
  id: row.id,
  storeId: row.store_id,
  openedByUserId: row.opened_by_user_id,
  openedByName: row.opened_by?.full_name ?? null,
  closedByUserId: row.closed_by_user_id,
  closedByName: row.closed_by?.full_name ?? null,
  openingAmount: Number(row.opening_amount),
  closingAmount: row.closing_amount !== null ? Number(row.closing_amount) : null,
  expectedAmount: row.expected_amount !== null ? Number(row.expected_amount) : null,
  difference: row.difference !== null ? Number(row.difference) : null,
  salesTotal: row.sales_total !== null ? Number(row.sales_total) : null,
  cashSalesTotal: row.cash_sales_total !== null ? Number(row.cash_sales_total) : null,
  salesCount: row.sales_count !== null ? Number(row.sales_count) : null,
  openingNote: row.opening_note,
  closingNote: row.closing_note,
  status: row.status as 'OPEN' | 'CLOSED',
  openedAt: row.opened_at,
  closedAt: row.closed_at,
});

export class CashRegisterService {
  private get client() {
    return getSupabaseClient();
  }

  private async fetchById(id: string) {
    const { data, error } = await this.client
      .from('cash_registers')
      .select('*, opened_by:users!cash_registers_opened_by_user_id_fkey(full_name), closed_by:users!cash_registers_closed_by_user_id_fkey(full_name)')
      .eq('id', id)
      .single();
    throwIfError(error);
    return mapRegister(data);
  }

  /** Devuelve la caja abierta actualmente para la droguería, o null si no hay ninguna. */
  async getCurrent(storeId: string) {
    const { data, error } = await this.client
      .from('cash_registers')
      .select('*, opened_by:users!cash_registers_opened_by_user_id_fkey(full_name), closed_by:users!cash_registers_closed_by_user_id_fkey(full_name)')
      .eq('store_id', storeId)
      .eq('status', 'OPEN')
      .maybeSingle();
    throwIfError(error);
    if (!data) return null;

    const register = mapRegister(data);
    const salesSoFar = await this.salesSince(storeId, register.openedAt);

    return {
      ...register,
      salesTotalSoFar: salesSoFar.total,
      cashSalesTotalSoFar: salesSoFar.cashTotal,
      salesCountSoFar: salesSoFar.count,
    };
  }

  /**
   * Historial de turnos de caja. Si se pasa `userId`, solo devuelve los turnos
   * abiertos por ese usuario (usado para que un Cajero solo vea los suyos).
   */
  async history(storeId: string, userId?: string) {
    let query = this.client
      .from('cash_registers')
      .select('*, opened_by:users!cash_registers_opened_by_user_id_fkey(full_name), closed_by:users!cash_registers_closed_by_user_id_fkey(full_name)')
      .eq('store_id', storeId);

    if (userId) {
      query = query.eq('opened_by_user_id', userId);
    }

    const { data, error } = await query.order('opened_at', { ascending: false }).limit(50);
    throwIfError(error);
    return (data || []).map(mapRegister);
  }

  private async salesSince(storeId: string, sinceIso: string, untilIso?: string) {
    let query = this.client
      .from('sales')
      .select('total, payment_method', { count: 'exact' })
      .eq('store_id', storeId)
      .eq('status', 'CONFIRMED')
      .gte('created_at', sinceIso);

    if (untilIso) {
      query = query.lte('created_at', untilIso);
    }

    const { data, error, count } = await query;
    throwIfError(error);

    const total = (data || []).reduce((sum: number, row: any) => sum + Number(row.total), 0);
    // Solo las ventas en EFECTIVO afectan el efectivo físico esperado en caja.
    // Las pagadas con tarjeta/transferencia no entran ni salen del cajón.
    const cashTotal = (data || [])
      .filter((row: any) => row.payment_method === 'CASH')
      .reduce((sum: number, row: any) => sum + Number(row.total), 0);
    return { total, cashTotal, count: count ?? (data || []).length };
  }

  async open(input: OpenCashRegisterInput) {
    if (input.openingAmount < 0) {
      throw ApiError.badRequest('El monto de apertura no puede ser negativo');
    }

    const existing = await this.getCurrent(input.storeId);
    if (existing) {
      throw ApiError.badRequest('Ya hay una caja abierta. Cierra la caja actual antes de abrir una nueva.');
    }

    const id = generateId();
    const { error } = await this.client.from('cash_registers').insert({
      id,
      store_id: input.storeId,
      opened_by_user_id: input.actorUserId,
      opening_amount: input.openingAmount,
      opening_note: input.note || null,
      status: 'OPEN',
    });
    throwIfError(error);

    await createAuditLog({
      entityType: 'cash_register',
      entityId: id,
      action: 'cash_register.opened',
      description: `Apertura de caja con ${input.openingAmount}`,
      userId: input.actorUserId,
      ipAddress: input.ipAddress,
      metadata: { openingAmount: input.openingAmount },
    });

    return this.fetchById(id);
  }

  async close(input: CloseCashRegisterInput) {
    if (input.closingAmount < 0) {
      throw ApiError.badRequest('El monto de cierre no puede ser negativo');
    }

    const current = await this.getCurrent(input.storeId);
    if (!current) {
      throw ApiError.badRequest('No hay ninguna caja abierta para cerrar');
    }

    const closedAt = new Date().toISOString();
    const { total: salesTotal, cashTotal: cashSalesTotal, count: salesCount } = await this.salesSince(
      input.storeId,
      current.openedAt,
      closedAt,
    );

    // El efectivo esperado en el cajón solo suma las ventas pagadas en EFECTIVO.
    // Ventas con tarjeta/transferencia se incluyen en salesTotal (para reportes)
    // pero no mueven el efectivo físico.
    const expectedAmount = current.openingAmount + cashSalesTotal;
    const difference = input.closingAmount - expectedAmount;

    const { error } = await this.client
      .from('cash_registers')
      .update({
        closed_by_user_id: input.actorUserId,
        closing_amount: input.closingAmount,
        expected_amount: expectedAmount,
        difference,
        sales_total: salesTotal,
        cash_sales_total: cashSalesTotal,
        sales_count: salesCount,
        closing_note: input.note || null,
        status: 'CLOSED',
        closed_at: closedAt,
        updated_at: closedAt,
      })
      .eq('id', current.id)
      .eq('status', 'OPEN');
    throwIfError(error);

    await createAuditLog({
      entityType: 'cash_register',
      entityId: current.id,
      action: 'cash_register.closed',
      description: `Cierre de caja. Ventas del turno: ${salesTotal}`,
      userId: input.actorUserId,
      ipAddress: input.ipAddress,
      metadata: { closingAmount: input.closingAmount, expectedAmount, difference, salesTotal, salesCount },
    });

    return this.fetchById(current.id);
  }
}
