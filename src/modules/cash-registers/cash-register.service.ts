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
    const cogsSoFar = await this.cogsForSales(salesSoFar.saleIds);

    return {
      ...register,
      salesTotalSoFar: salesSoFar.total,
      cashSalesTotalSoFar: salesSoFar.cashTotal,
      salesCountSoFar: salesSoFar.count,
      cogsTotalSoFar: cogsSoFar,
      profitTotalSoFar: cogsSoFar === null ? null : salesSoFar.total - cogsSoFar,
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
      .select('id, total, payment_method', { count: 'exact' })
      .eq('store_id', storeId)
      .neq('status', 'CANCELLED')
      .gte('created_at', sinceIso);

    if (untilIso) {
      query = query.lte('created_at', untilIso);
    }

    const { data, error, count } = await query;
    throwIfError(error);

    const rows = (data ?? []) as unknown as Array<{ id: string; total: number; payment_method: string }>;

    // Consultar devoluciones realizadas durante el turno para descontar el efectivo reintegrado
    let returnsQuery = this.client
      .from('sale_returns')
      .select('total_refund')
      .eq('store_id', storeId)
      .gte('created_at', sinceIso);

    if (untilIso) {
      returnsQuery = returnsQuery.lte('created_at', untilIso);
    }

    const { data: returnsData } = await returnsQuery;
    const refundsTotal = (returnsData ?? []).reduce((sum: number, r: any) => sum + Number(r.total_refund || 0), 0);

    const rawTotal = rows.reduce((sum, row) => sum + Number(row.total), 0);
    const rawCashTotal = rows
      .filter((row) => row.payment_method === 'CASH')
      .reduce((sum, row) => sum + Number(row.total), 0);

    const total = Math.max(0, rawTotal - refundsTotal);
    // Solo las ventas en EFECTIVO afectan el efectivo físico esperado en caja menos los reembolsos
    const cashTotal = Math.max(0, rawCashTotal - refundsTotal);

    return {
      total,
      cashTotal,
      refundsTotal,
      count: count ?? rows.length,
      saleIds: rows.map((row) => row.id),
    };
  }

  /**
   * Costo de los productos vendidos (COGS) de un conjunto de ventas.
   * Usa el costo congelado en cada línea (sale_items.unit_cost, migración 016)
   * y cae al costo actual del producto para ventas anteriores a esa migración.
   *
   * Devuelve null si no se puede calcular (por ejemplo, si la migración 016 aún
   * no se aplicó): así el cierre de caja nunca falla por esto.
   */
  private async cogsForSales(saleIds: string[]): Promise<number | null> {
    if (saleIds.length === 0) return 0;

    try {
      const { data, error } = await this.client
        .from('sale_items')
        .select('quantity, unit_cost, products(cost)')
        .in('sale_id', saleIds);

      if (error) throw new Error(error.message);

      const items = (data ?? []) as unknown as Array<{
        quantity: number;
        unit_cost: number | null;
        products?: { cost: number } | null;
      }>;

      return items.reduce((sum, item) => {
        const unitCost = Number(item.unit_cost) || Number(item.products?.cost) || 0;
        return sum + Number(item.quantity) * unitCost;
      }, 0);
    } catch (err: any) {
      console.warn('⚠️  No se pudo calcular el costo de lo vendido del turno:', err.message);
      return null;
    }
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
    const {
      total: salesTotal,
      cashTotal: cashSalesTotal,
      count: salesCount,
      saleIds,
    } = await this.salesSince(input.storeId, current.openedAt, closedAt);

    // Rentabilidad del turno: Utilidad = Ventas - Costo de lo vendido
    const cogsTotal = await this.cogsForSales(saleIds);
    const profitTotal = cogsTotal === null ? null : salesTotal - cogsTotal;

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
      metadata: {
        closingAmount: input.closingAmount,
        expectedAmount,
        difference,
        salesTotal,
        salesCount,
        cogsTotal,
        profitTotal,
      },
    });

    const register = await this.fetchById(current.id);

    // El COGS no se persiste en cash_registers: se devuelve calculado para el
    // resumen que se muestra al cerrar el turno.
    return { ...register, cogsTotal, profitTotal };
  }
}
