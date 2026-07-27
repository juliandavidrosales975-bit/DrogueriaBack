import { getSupabaseClient, throwIfError } from '@core/database/connection';

export class DashboardService {
  private get client() {
    return getSupabaseClient();
  }

  async summary(storeId: string) {
    const [
      { count: products, error: e1 },
      { count: customers, error: e2 },
      { count: suppliers, error: e3 },
      { count: salesCount, error: e4 },
      { count: purchasesCount, error: e5 },
    ] = await Promise.all([
      this.client.from('products').select('*', { count: 'exact', head: true }).eq('store_id', storeId),
      this.client.from('customers').select('*', { count: 'exact', head: true }).eq('store_id', storeId),
      this.client.from('suppliers').select('*', { count: 'exact', head: true }).eq('store_id', storeId),
      this.client.from('sales').select('*', { count: 'exact', head: true }).eq('store_id', storeId),
      this.client.from('purchases').select('*', { count: 'exact', head: true }).eq('store_id', storeId),
    ]);
    throwIfError(e1); throwIfError(e2); throwIfError(e3); throwIfError(e4); throwIfError(e5);

    const { data: recentSales, error: e6 } = await this.client
      .from('sales')
      .select('*, customers(full_name)')
      .eq('store_id', storeId)
      .order('created_at', { ascending: false })
      .limit(5);
    throwIfError(e6);

    const { data: recentPurchases, error: e7 } = await this.client
      .from('purchases')
      .select('*, suppliers(business_name)')
      .eq('store_id', storeId)
      .order('created_at', { ascending: false })
      .limit(5);
    throwIfError(e7);

    const { data: products_, error: e8 } = await this.client
      .from('products')
      .select('*')
      .eq('store_id', storeId)
      .order('stock', { ascending: true });
    throwIfError(e8);

    const lowStock = (products_ || []).filter((p: any) => p.stock <= p.min_stock).slice(0, 10);

    // Si la migración 016 (RPC de rentabilidad) aún no se aplicó, el resumen no
    // debe romperse: se devuelven ceros y se avisa en el log.
    const [today, daily] = await Promise.all([
      this.profit(storeId).catch((err) => {
        console.warn('⚠️  No se pudo calcular la rentabilidad del día:', err.message);
        return { salesTotal: 0, cogs: 0, profit: 0, salesCount: 0, purchasesTotal: 0 };
      }),
      this.profitDaily(storeId, 14).catch(() => [] as Awaited<ReturnType<DashboardService['profitDaily']>>),
    ]);

    return {
      counts: {
        products: products || 0,
        customers: customers || 0,
        suppliers: suppliers || 0,
        sales: salesCount || 0,
        purchases: purchasesCount || 0,
      },
      recentSales,
      recentPurchases,
      lowStock,
      today,
      profitDaily: daily,
    };
  }

  /**
   * Rentabilidad de un rango de fechas: Utilidad = Ventas - COGS.
   * El COGS usa el costo congelado en cada línea de venta (sale_items.unit_cost),
   * no el costo actual del producto, que cambia con cada compra.
   * Sin fechas devuelve el día de hoy (zona horaria America/Bogota).
   */
  async profit(storeId: string, from?: string, to?: string) {
    const { data, error } = await this.client.rpc('store_profit_summary', {
      p_store_id: storeId,
      p_from: from ?? null,
      p_to: to ?? null,
    });
    throwIfError(error);

    const row: any = Array.isArray(data) ? data[0] : data;

    return {
      salesTotal: Number(row?.sales_total ?? 0),
      cogs: Number(row?.cogs ?? 0),
      profit: Number(row?.profit ?? 0),
      salesCount: Number(row?.sales_count ?? 0),
      purchasesTotal: Number(row?.purchases_total ?? 0),
    };
  }

  /** Serie diaria de ventas / costo / utilidad para los gráficos */
  async profitDaily(storeId: string, days = 14) {
    const { data, error } = await this.client.rpc('store_profit_daily', {
      p_store_id: storeId,
      p_days: days,
    });
    throwIfError(error);

    return (data || []).map((row: any) => ({
      day: row.day as string,
      salesTotal: Number(row.sales_total ?? 0),
      cogs: Number(row.cogs ?? 0),
      profit: Number(row.profit ?? 0),
    }));
  }
}
