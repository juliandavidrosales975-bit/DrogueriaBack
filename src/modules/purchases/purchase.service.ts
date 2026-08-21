import { getSupabaseClient, throwIfError } from '@core/database/connection';
import { ApiError } from '@shared/errors/ApiError';
import { createAuditLog } from '@shared/utils/audit';
import { generateId } from '@shared/utils/cuid';

type PurchaseItemInput = {
  productId?: string | null;
  customName?: string | null;
  quantity: number;
  unitCost: number;
  unitFactor?: number;
  unitLabel?: string;
  productUnitId?: string | null;
  /**
   * Precio de venta a aplicar al producto (o a la presentación comprada) junto
   * con la compra. Si no viene, el precio de venta se deja como estaba.
   */
  salePrice?: number | null;
};

export type PurchasePaymentStatus = 'PAID' | 'PARTIAL' | 'PENDING';
export type PaymentMethod = 'CASH' | 'CARD' | 'TRANSFER' | 'OTHER';

type PurchaseInput = {
  supplierId?: string | null;
  invoiceNumber?: string;
  notes?: string;
  tax?: number;
  items: PurchaseItemInput[];
  paymentStatus?: PurchasePaymentStatus;
  paymentMethod?: PaymentMethod;
  isExternal?: boolean;
  amountPaid?: number;
  actorUserId: string;
  ipAddress?: string;
  storeId: string;
};

type UpdatePurchaseInput = PurchaseInput & {
  purchaseId: string;
};

/** Fila mínima de `purchases` usada para cálculos de saldo y validaciones */
type PurchaseBalanceRow = {
  id: string;
  supplier_id?: string | null;
  status: string;
  total: number;
  amount_paid: number;
  payment_status: PurchasePaymentStatus;
  payment_method?: PaymentMethod;
  is_external?: boolean;
  suppliers?: { business_name: string } | null;
};

type RegisterPaymentInput = {
  purchaseId: string;
  amount: number;
  paymentMethod?: PaymentMethod;
  note?: string;
  actorUserId: string;
  ipAddress?: string;
  storeId: string;
};

/**
 * Selección estándar de una compra con proveedor, ítems (incluyendo la
 * presentación y el precio de venta aplicado) y su historial de pagos.
 * Se comparte entre list/create/update para que el frontend siempre reciba la
 * misma forma y pueda reconstruir la compra en el modal de edición.
 */
const PURCHASE_SELECT = `*, suppliers(business_name), users(full_name),
   purchase_items(id, product_id, custom_name, product_unit_id, quantity, unit_cost, line_total, unit_label, unit_factor, unit_quantity, sale_price, products(name, sku)),
   supplier_payments(id, amount, payment_method, note, created_at)`;

export class PurchaseService {
  private get client() {
    return getSupabaseClient();
  }

  /** Normaliza los ítems al formato JSONB que esperan las RPC de Postgres */
  private mapItems(items: PurchaseItemInput[]) {
    return items.map((item) => ({
      productId: item.productId || null,
      customName: item.customName || null,
      unitQuantity: item.quantity,
      unitCost: item.unitCost,
      unitFactor: item.unitFactor ?? 1,
      unitLabel: item.unitLabel ?? 'Unidad',
      productUnitId: item.productUnitId ?? null,
      salePrice: item.salePrice ?? null,
    }));
  }

  private validateItems(items: PurchaseItemInput[]) {
    if (!items?.length) {
      throw ApiError.badRequest('La compra debe incluir al menos un ítem');
    }
    for (const item of items) {
      if (!item.productId && !item.customName?.trim()) {
        throw ApiError.badRequest('Cada ítem debe tener un producto del inventario o un nombre de compra externa');
      }
      if (!item.quantity || item.quantity <= 0) {
        throw ApiError.badRequest('La cantidad de cada ítem debe ser mayor a 0');
      }
      if (item.unitCost === undefined || item.unitCost === null || item.unitCost < 0) {
        throw ApiError.badRequest('El costo unitario no puede ser negativo');
      }
      if (item.salePrice !== undefined && item.salePrice !== null && item.salePrice < 0) {
        throw ApiError.badRequest('El precio de venta no puede ser negativo');
      }
    }
  }

  async list(storeId: string) {
    const { data, error } = await this.client
      .from('purchases')
      .select(PURCHASE_SELECT)
      .eq('store_id', storeId)
      .order('created_at', { ascending: false });
    throwIfError(error);
    return data;
  }

  /**
   * Cuentas por pagar: total pendiente agrupado por proveedor, considerando
   * solo compras con saldo (PENDING o PARTIAL).
   */
  async outstandingBySupplier(storeId: string) {
    const { data, error } = await this.client
      .from('purchases')
      .select('supplier_id, total, amount_paid, payment_status, suppliers(business_name)')
      .eq('store_id', storeId)
      .in('payment_status', ['PENDING', 'PARTIAL']);
    throwIfError(error);

    // Los tipos generados de Supabase (supabase.types.ts) están desactualizados
    // respecto a las últimas migraciones, así que la inferencia del select se
    // rompe. Se acota el tipo manualmente a las columnas pedidas.
    const rows = (data ?? []) as unknown as PurchaseBalanceRow[];

    const bySupplier = new Map<string, { supplierId: string; supplierName: string; balance: number; purchaseCount: number }>();
    for (const row of rows) {
      const balance = Number(row.total) - Number(row.amount_paid);
      const supplierId = row.supplier_id ?? 'unknown';
      const existing = bySupplier.get(supplierId);
      const supplierName = row.suppliers?.business_name ?? 'Desconocido';
      if (existing) {
        existing.balance += balance;
        existing.purchaseCount += 1;
      } else {
        bySupplier.set(supplierId, {
          supplierId,
          supplierName,
          balance,
          purchaseCount: 1,
        });
      }
    }

    return Array.from(bySupplier.values()).sort((a, b) => b.balance - a.balance);
  }

  async create(input: PurchaseInput) {
    this.validateItems(input.items);

    const total = input.items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0)
      + (input.tax ?? 0);

    const paymentStatus = input.paymentStatus ?? 'PAID';
    if (paymentStatus === 'PARTIAL') {
      const amountPaid = input.amountPaid ?? 0;
      if (amountPaid <= 0 || amountPaid >= total) {
        throw ApiError.badRequest('El monto abonado debe ser mayor a 0 y menor al total para un pago parcial');
      }
    }

    const { data: purchaseId, error } = await this.client.rpc('create_purchase', {
      p_supplier_id: input.supplierId || null,
      p_user_id: input.actorUserId,
      p_invoice_number: input.invoiceNumber || null,
      p_notes: input.notes || null,
      p_tax: input.tax ?? 0,
      p_store_id: input.storeId,
      p_payment_status: paymentStatus,
      p_amount_paid: paymentStatus === 'PARTIAL' ? input.amountPaid : null,
      p_items: this.mapItems(input.items),
      p_payment_method: input.paymentMethod ?? 'CASH',
      p_is_external: input.isExternal ?? false,
    });

    if (error) {
      throw ApiError.badRequest(error.message);
    }

    const { data: purchase, error: fetchError } = await this.client
      .from('purchases')
      .select(PURCHASE_SELECT)
      .eq('id', purchaseId as string)
      .single();
    throwIfError(fetchError);

    await createAuditLog({
      entityType: 'purchase',
      entityId: purchaseId as string,
      action: 'purchase.created',
      description: 'Compra registrada',
      userId: input.actorUserId,
      ipAddress: input.ipAddress,
      metadata: { supplierId: input.supplierId, total, paymentStatus },
    });

    return purchase;
  }

  /**
   * Edita una compra ya registrada: reemplaza sus ítems (agregar/quitar
   * productos, cambiar cantidades, costos y precio de venta) y ajusta el
   * inventario por la diferencia neta.
   *
   * La RPC `update_purchase` rechaza la edición si el stock de algún producto
   * quedaría negativo (mercancía de esa compra ya vendida).
   */
  async update(input: UpdatePurchaseInput) {
    this.validateItems(input.items);

    const { data: existingRow, error: existingError } = await this.client
      .from('purchases')
      .select('id, status')
      .eq('id', input.purchaseId)
      .eq('store_id', input.storeId)
      .maybeSingle();
    throwIfError(existingError);

    const existing = existingRow as unknown as Pick<PurchaseBalanceRow, 'id' | 'status'> | null;

    if (!existing) {
      throw ApiError.notFound('Compra no encontrada');
    }
    if (existing.status === 'CANCELLED') {
      throw ApiError.badRequest('No se puede editar una compra anulada');
    }

    const total = input.items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0)
      + (input.tax ?? 0);

    if (input.paymentStatus === 'PARTIAL') {
      const amountPaid = input.amountPaid ?? 0;
      if (amountPaid <= 0 || amountPaid >= total) {
        throw ApiError.badRequest('El monto abonado debe ser mayor a 0 y menor al total para un pago parcial');
      }
    }

    const { error } = await this.client.rpc('update_purchase', {
      p_purchase_id: input.purchaseId,
      p_store_id: input.storeId,
      p_user_id: input.actorUserId,
      p_supplier_id: input.supplierId,
      p_invoice_number: input.invoiceNumber || null,
      p_notes: input.notes || null,
      p_tax: input.tax ?? 0,
      p_payment_status: input.paymentStatus ?? null,
      p_amount_paid: input.amountPaid ?? null,
      p_items: this.mapItems(input.items),
    });

    if (error) {
      throw ApiError.badRequest(error.message);
    }

    const { data: purchase, error: fetchError } = await this.client
      .from('purchases')
      .select(PURCHASE_SELECT)
      .eq('id', input.purchaseId)
      .single();
    throwIfError(fetchError);

    await createAuditLog({
      entityType: 'purchase',
      entityId: input.purchaseId,
      action: 'purchase.updated',
      description: 'Compra editada (ítems y/o costos actualizados)',
      userId: input.actorUserId,
      ipAddress: input.ipAddress,
      metadata: { supplierId: input.supplierId, total, items: input.items.length },
    });

    return purchase;
  }

  /**
   * Registra un abono/pago a una compra existente. Actualiza amount_paid y
   * recalcula payment_status (PENDING -> PARTIAL -> PAID) según el saldo restante.
   */
  async registerPayment(input: RegisterPaymentInput) {
    if (input.amount <= 0) {
      throw ApiError.badRequest('El monto del pago debe ser mayor a 0');
    }

    const { data: purchaseRow, error: fetchError } = await this.client
      .from('purchases')
      .select('id, supplier_id, total, amount_paid, payment_status')
      .eq('id', input.purchaseId)
      .eq('store_id', input.storeId)
      .maybeSingle();
    throwIfError(fetchError);

    const purchase = purchaseRow as unknown as PurchaseBalanceRow | null;

    if (!purchase) {
      throw ApiError.notFound('Compra no encontrada');
    }
    if (purchase.payment_status === 'PAID') {
      throw ApiError.badRequest('Esta compra ya está pagada en su totalidad');
    }

    const currentPaid = Number(purchase.amount_paid);
    const total = Number(purchase.total);
    const remaining = total - currentPaid;

    if (input.amount > remaining) {
      throw ApiError.badRequest(`El pago (${input.amount}) supera el saldo pendiente (${remaining})`);
    }

    const newAmountPaid = currentPaid + input.amount;
    const newStatus = newAmountPaid >= total ? 'PAID' : 'PARTIAL';

    const { error: updateError } = await this.client
      .from('purchases')
      .update({ amount_paid: newAmountPaid, payment_status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', input.purchaseId)
      .eq('store_id', input.storeId);
    throwIfError(updateError);

    const { error: insertError } = await this.client.from('supplier_payments').insert({
      id: generateId(),
      store_id: input.storeId,
      purchase_id: input.purchaseId,
      supplier_id: purchase.supplier_id,
      user_id: input.actorUserId,
      amount: input.amount,
      payment_method: input.paymentMethod ?? 'CASH',
      note: input.note || null,
    });
    throwIfError(insertError);

    await createAuditLog({
      entityType: 'purchase',
      entityId: input.purchaseId,
      action: 'purchase.payment_registered',
      description: `Pago a proveedor registrado: ${input.amount}`,
      userId: input.actorUserId,
      ipAddress: input.ipAddress,
      metadata: { amount: input.amount, newAmountPaid, newStatus },
    });

    const { data: updated, error: refetchError } = await this.client
      .from('purchases')
      .select(PURCHASE_SELECT)
      .eq('id', input.purchaseId)
      .single();
    throwIfError(refetchError);

    return updated;
  }
}
