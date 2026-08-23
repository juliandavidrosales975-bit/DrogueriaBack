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
      transferSalesTotalSoFar: salesSoFar.transferTotal,
      cardSalesTotalSoFar: salesSoFar.cardTotal,
      pendingSalesTotalSoFar: salesSoFar.pendingTotal,
      salesByPaymentMethodSoFar: salesSoFar.byPaymentMethod,
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
    // 1. Ventas creadas durante el turno (excluyendo canceladas y devueltas)
    let query = this.client
      .from('sales')
      .select('id, total, payment_method, payment_method_2, amount_paid_1, amount_paid_2, status, created_at, updated_at', { count: 'exact' })
      .eq('store_id', storeId)
      .neq('status', 'CANCELLED')
      .neq('status', 'RETURNED')
      .gte('created_at', sinceIso);

    if (untilIso) {
      query = query.lte('created_at', untilIso);
    }

    const { data, error, count } = await query;
    throwIfError(error);

    let rows = ((data ?? []) as unknown as Array<{
      id: string;
      total: number;
      status: string;
      payment_method: string;
      payment_method_2?: string | null;
      amount_paid_1?: number | null;
      amount_paid_2?: number | null;
      created_at: string;
      updated_at: string;
    }>);

    // 2. Facturas que se originaron antes del turno como PENDING (fiado) pero fueron pagadas durante el turno
    try {
      let paidCreditsQuery = this.client
        .from('sales')
        .select('id, total, payment_method, payment_method_2, amount_paid_1, amount_paid_2, status, created_at, updated_at')
        .eq('store_id', storeId)
        .neq('status', 'CANCELLED')
        .neq('status', 'RETURNED')
        .neq('payment_method', 'PENDING')
        .lt('created_at', sinceIso)
        .gte('updated_at', sinceIso);

      if (untilIso) {
        paidCreditsQuery = paidCreditsQuery.lte('updated_at', untilIso);
      }

      const { data: paidCreditsData } = await paidCreditsQuery;
      if (paidCreditsData && paidCreditsData.length > 0) {
        const existingIds = new Set(rows.map((r) => r.id));
        for (const pRow of paidCreditsData as any[]) {
          if (!existingIds.has(pRow.id)) {
            rows.push(pRow);
          }
        }
      }
    } catch {
      // Ignorar si no se puede ejecutar la consulta adicional
    }

    // 3. Consultar devoluciones realizadas durante el turno junto con la venta origen
    let returnsQuery = this.client
      .from('sale_returns')
      .select('total_refund, sale_id, sales(payment_method, payment_method_2, total, amount_paid_1, amount_paid_2)')
      .eq('store_id', storeId)
      .gte('created_at', sinceIso);

    if (untilIso) {
      returnsQuery = returnsQuery.lte('created_at', untilIso);
    }

    const { data: returnsData } = await returnsQuery;
    const returnRows = (returnsData ?? []) as unknown as Array<{
      total_refund: number;
      sale_id: string;
      sales?: {
        payment_method: string;
        payment_method_2?: string | null;
        total?: number;
        amount_paid_1?: number | null;
        amount_paid_2?: number | null;
      } | null;
    }>;
    const refundsTotal = returnRows.reduce((sum, r) => sum + Number(r.total_refund || 0), 0);

    const byPaymentMethod: Record<string, number> = {
      CASH: 0,
      TRANSFER: 0,
      CARD: 0,
      PENDING: 0,
      OTHER: 0,
    };

    // Acumular ingresos por método de pago para las ventas del turno.
    for (const row of rows) {
      const rowTotal = Number(row.total || 0);

      if (row.payment_method_2) {
        const pm1 = row.payment_method || 'CASH';
        const pm2 = row.payment_method_2 || 'TRANSFER';

        let amt1 = row.amount_paid_1 !== null && row.amount_paid_1 !== undefined ? Number(row.amount_paid_1) : null;
        let amt2 = row.amount_paid_2 !== null && row.amount_paid_2 !== undefined ? Number(row.amount_paid_2) : null;

        if ((amt1 === null || isNaN(amt1)) && (amt2 === null || isNaN(amt2))) {
          amt1 = rowTotal;
          amt2 = 0;
        } else if (amt1 === null || isNaN(amt1)) {
          amt1 = Math.max(0, rowTotal - (amt2 || 0));
        } else if (amt2 === null || isNaN(amt2)) {
          amt2 = Math.max(0, rowTotal - (amt1 || 0));
        } else {
          const sum = amt1 + amt2;
          if (sum === 0 && rowTotal > 0) {
            amt1 = rowTotal;
            amt2 = 0;
          } else if (sum > 0 && Math.abs(sum - rowTotal) > 0.01) {
            const ratio1 = amt1 / sum;
            amt1 = Math.round(rowTotal * ratio1 * 100) / 100;
            amt2 = Math.round((rowTotal - amt1) * 100) / 100;
          }
        }

        if (byPaymentMethod[pm1] !== undefined) byPaymentMethod[pm1] += (amt1 || 0);
        else byPaymentMethod.OTHER += (amt1 || 0);

        if (byPaymentMethod[pm2] !== undefined) byPaymentMethod[pm2] += (amt2 || 0);
        else byPaymentMethod.OTHER += (amt2 || 0);
      } else {
        const pm = row.payment_method || 'CASH';
        if (byPaymentMethod[pm] !== undefined) byPaymentMethod[pm] += rowTotal;
        else byPaymentMethod.OTHER += rowTotal;
      }
    }

    // Descontar devoluciones del método correspondiente
    for (const ret of returnRows) {
      const sale = ret.sales;
      const refund = Number(ret.total_refund || 0);
      if (refund <= 0) continue;

      if (sale && sale.payment_method_2) {
        const saleTotal = Number(sale.total || 0);
        let amt1 = sale.amount_paid_1 != null ? Number(sale.amount_paid_1) : null;
        let amt2 = sale.amount_paid_2 != null ? Number(sale.amount_paid_2) : null;
        if (amt1 == null && amt2 == null) { amt1 = saleTotal; amt2 = 0; }
        else if (amt1 == null) { amt1 = Math.max(0, saleTotal - (amt2 || 0)); }
        else if (amt2 == null) { amt2 = Math.max(0, saleTotal - (amt1 || 0)); }

        const sum = (amt1 || 0) + (amt2 || 0);
        const ratio1 = sum > 0 ? (amt1 || 0) / sum : 0.5;
        const refund1 = Math.round(refund * ratio1 * 100) / 100;
        const refund2 = Math.round((refund - refund1) * 100) / 100;

        const pm1 = sale.payment_method || 'CASH';
        const pm2 = sale.payment_method_2 || 'TRANSFER';
        if (byPaymentMethod[pm1] !== undefined) byPaymentMethod[pm1] = Math.max(0, byPaymentMethod[pm1] - refund1);
        if (byPaymentMethod[pm2] !== undefined) byPaymentMethod[pm2] = Math.max(0, byPaymentMethod[pm2] - refund2);
      } else if (sale) {
        const pm = sale.payment_method || 'CASH';
        if (byPaymentMethod[pm] !== undefined) {
          byPaymentMethod[pm] = Math.max(0, byPaymentMethod[pm] - refund);
        } else {
          byPaymentMethod.OTHER = Math.max(0, byPaymentMethod.OTHER - refund);
        }
      } else {
        if (byPaymentMethod.CASH >= refund) {
          byPaymentMethod.CASH = Math.max(0, byPaymentMethod.CASH - refund);
        } else {
          byPaymentMethod.OTHER = Math.max(0, byPaymentMethod.OTHER - refund);
        }
      }
    }

    // Consultar abonos a reservas recibidos durante el turno (Efectivo y Transferencias)
    try {
      let advancesQuery = this.client
        .from('reservation_advances')
        .select('amount, payment_method')
        .eq('store_id', storeId)
        .gte('created_at', sinceIso);

      if (untilIso) {
        advancesQuery = advancesQuery.lte('created_at', untilIso);
      }

      const { data: advancesData } = await advancesQuery;
      const advanceRows = (advancesData ?? []) as unknown as Array<{
        amount: number;
        payment_method: string;
      }>;

      for (const adv of advanceRows) {
        const amt = Number(adv.amount || 0);
        const pm = adv.payment_method || 'CASH';
        if (byPaymentMethod[pm] !== undefined) byPaymentMethod[pm] += amt;
        else byPaymentMethod.OTHER += amt;
      }
    } catch {
      // Ignorar si la tabla aún no se ha creado
    }

    // Redondear valores de métodos
    for (const k of Object.keys(byPaymentMethod)) {
      byPaymentMethod[k] = Math.round((byPaymentMethod[k] || 0) * 100) / 100;
    }

    const total = Object.values(byPaymentMethod).reduce((sum, v) => sum + v, 0);
    const cashTotal = byPaymentMethod.CASH || 0;
    const transferTotal = byPaymentMethod.TRANSFER || 0;
    const cardTotal = byPaymentMethod.CARD || 0;
    const pendingTotal = byPaymentMethod.PENDING || 0;

    return {
      total,
      cashTotal,
      transferTotal,
      cardTotal,
      pendingTotal,
      byPaymentMethod,
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
      byPaymentMethod,
      count: salesCount,
      saleIds,
    } = await this.salesSince(input.storeId, current.openedAt, closedAt);

    // Rentabilidad del turno: Utilidad = Ventas - Costo de lo vendido
    const cogsTotal = await this.cogsForSales(saleIds);
    const profitTotal = cogsTotal === null ? null : salesTotal - cogsTotal;

    // El total esperado en caja suma el monto de apertura más el total de ventas del turno
    const expectedAmount = current.openingAmount + salesTotal;
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
        byPaymentMethod,
      },
    });

    const register = await this.fetchById(current.id);

    // El COGS no se persiste en cash_registers: se devuelve calculado para el
    // resumen que se muestra al cerrar el turno.
    return { ...register, cogsTotal, profitTotal, byPaymentMethod };
  }
}
