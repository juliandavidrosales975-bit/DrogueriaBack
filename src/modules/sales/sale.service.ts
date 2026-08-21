import { getSupabaseClient, throwIfError } from '@core/database/connection';
import { ApiError } from '@shared/errors/ApiError';
import { createAuditLog } from '@shared/utils/audit';

type SaleItemInput = {
  productId: string;
  quantity: number;
  unitPrice: number;
  unitFactor?: number;
  unitLabel?: string;
  productUnitId?: string | null;
};

export type PaymentMethod = 'CASH' | 'CARD' | 'TRANSFER' | 'PENDING' | 'OTHER';

type SaleInput = {
  customerId?: string;
  customerName?: string;
  notes?: string;
  tax?: number;
  discount?: number;
  paymentMethod?: PaymentMethod;
  paymentMethod2?: PaymentMethod | null;
  amountPaid1?: number | null;
  amountPaid2?: number | null;
  items: SaleItemInput[];
  actorUserId: string;
  ipAddress?: string;
  storeId: string;
};

export class SaleService {
  private get client() {
    return getSupabaseClient();
  }

  /**
   * Lista las ventas de la droguería. Si se pasa `userId`, solo devuelve las
   * ventas registradas por ese usuario (usado para que un Cajero solo vea las suyas).
   * Excluye ventas CANCELLED y RETURNED (devueltas totalmente) ya que no generan ingresos.
   */
  async list(storeId: string, userId?: string) {
    let query = this.client
      .from('sales')
      .select(
        `*, customers(full_name), users(full_name),
         sale_items(id, product_id, quantity, unit_price, unit_cost, line_total, unit_label, unit_factor, unit_quantity, products(name))`
      )
      .eq('store_id', storeId)
      .neq('status', 'CANCELLED')
      .neq('status', 'RETURNED');

    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query.order('created_at', { ascending: false });
    throwIfError(error);
    return data;
  }

  async create(input: SaleInput) {
    if (!input.items?.length) {
      throw ApiError.badRequest('La venta debe incluir al menos un ítem');
    }

    const isPending = input.paymentMethod === 'PENDING' || input.paymentMethod2 === 'PENDING';
    if (isPending && !input.customerId && !input.customerName?.trim()) {
      throw ApiError.badRequest('Debes especificar el nombre de la persona que debe la factura para marcarla como pendiente de pago');
    }

    const { data: openRegister, error: registerError } = await this.client
      .from('cash_registers')
      .select('id')
      .eq('store_id', input.storeId)
      .eq('status', 'OPEN')
      .maybeSingle();
    throwIfError(registerError);

    if (!openRegister) {
      throw ApiError.badRequest('Debes abrir la caja antes de registrar ventas');
    }

    const total = input.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
      + (input.tax ?? 0) - (input.discount ?? 0);

    const notesValue = input.notes
      || (input.customerName ? `Cliente: ${input.customerName}` : null);

    const { data: saleId, error } = await this.client.rpc('create_sale', {
      p_customer_id: input.customerId || null,
      p_user_id: input.actorUserId,
      p_notes: notesValue,
      p_tax: input.tax ?? 0,
      p_discount: input.discount ?? 0,
      p_store_id: input.storeId,
      p_payment_method: input.paymentMethod ?? 'CASH',
      p_payment_method_2: input.paymentMethod2 || null,
      p_amount_paid_1: input.amountPaid1 ?? null,
      p_amount_paid_2: input.amountPaid2 ?? null,
      p_items: input.items.map((item) => ({
        productId: item.productId,
        unitQuantity: item.quantity,
        unitPrice: item.unitPrice,
        unitFactor: item.unitFactor ?? 1,
        unitLabel: item.unitLabel ?? 'Unidad',
        productUnitId: item.productUnitId ?? null,
      })),
    });

    if (error) {
      throw ApiError.badRequest(error.message);
    }

    const { data: sale, error: fetchError } = await this.client
      .from('sales')
      .select(
        `*, customers(full_name),
         sale_items(id, product_id, quantity, unit_price, line_total, unit_label, unit_factor, unit_quantity, products(name))`
      )
      .eq('id', saleId as string)
      .single();
    throwIfError(fetchError);

    await createAuditLog({
      entityType: 'sale',
      entityId: saleId as string,
      action: 'sale.created',
      description: isPending ? `Venta pendiente de pago (fiado) registrada para ${input.customerName || 'cliente'}` : 'Venta registrada',
      userId: input.actorUserId,
      ipAddress: input.ipAddress,
      metadata: { customerId: input.customerId, total, isPending },
    });

    return sale;
  }

  /**
   * Registra el pago de una factura que estaba en estado pendiente de pago (fiado).
   */
  async payPendingSale(saleId: string, input: { paymentMethod: PaymentMethod; note?: string; actorUserId: string; storeId: string; ipAddress?: string }) {
    const { data: existingData, error: findError } = await this.client
      .from('sales')
      .select('*')
      .eq('id', saleId)
      .eq('store_id', input.storeId)
      .single();
    throwIfError(findError);

    const existing = existingData as any;

    if (!existing) {
      throw ApiError.notFound('Venta no encontrada');
    }

    if (existing.payment_method !== 'PENDING') {
      throw ApiError.badRequest('Esta venta ya no está pendiente de pago');
    }

    const updatePayload: any = {
      payment_method: input.paymentMethod,
      amount_paid_1: existing.total,
      updated_at: new Date().toISOString(),
    };

    if (input.note) {
      updatePayload.notes = existing.notes ? `${existing.notes} | Pago: ${input.note}` : `Pago: ${input.note}`;
    }

    const { error: updateError } = await this.client
      .from('sales')
      .update(updatePayload)
      .eq('id', saleId)
      .eq('store_id', input.storeId);
    throwIfError(updateError);

    await createAuditLog({
      entityType: 'sale',
      entityId: saleId,
      action: 'sale.paid',
      description: `Pago registrado para factura ${saleId.substring(0, 8)} con método ${input.paymentMethod}`,
      userId: input.actorUserId,
      ipAddress: input.ipAddress,
      metadata: { previousMethod: existing.payment_method, newMethod: input.paymentMethod, total: existing.total },
    });

    const { data: updated, error: reloadError } = await this.client
      .from('sales')
      .select(
        `*, customers(full_name),
         sale_items(id, product_id, quantity, unit_price, line_total, unit_label, unit_factor, unit_quantity, products(name))`
      )
      .eq('id', saleId)
      .single();
    throwIfError(reloadError);

    return updated;
  }
}
