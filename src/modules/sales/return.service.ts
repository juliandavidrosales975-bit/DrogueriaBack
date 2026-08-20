import { getSupabaseClient, throwIfError } from '@core/database/connection';
import { ApiError } from '@shared/errors/ApiError';
import { createAuditLog } from '@shared/utils/audit';

type ReturnItemInput = {
  saleItemId: string;
  unitQuantity: number;
};

type CreateReturnInput = {
  saleId: string;
  notes: string;
  items: ReturnItemInput[];
  actorUserId: string;
  ipAddress?: string;
  storeId: string;
};

export class ReturnService {
  private get client() {
    return getSupabaseClient();
  }

  /** Registra una devolución parcial o total de una venta. */
  async create(input: CreateReturnInput) {
    if (!input.notes?.trim()) {
      throw ApiError.badRequest('La observación de la devolución es obligatoria');
    }
    if (!input.items?.length) {
      throw ApiError.badRequest('Debes seleccionar al menos un producto a devolver');
    }

    const { data: returnId, error } = await this.client.rpc('create_return', {
      p_sale_id: input.saleId,
      p_user_id: input.actorUserId,
      p_store_id: input.storeId,
      p_notes: input.notes.trim(),
      p_items: input.items.map((item) => ({
        saleItemId: item.saleItemId,
        unitQuantity: item.unitQuantity,
      })),
    });

    if (error) {
      throw ApiError.badRequest(error.message);
    }

    // Obtener la devolución creada con sus ítems
    const { data: saleReturn, error: fetchError } = await (this.client
      .from('sale_returns')
      .select(
        `*, users(full_name),
         sale_return_items(id, sale_item_id, product_id, quantity, unit_quantity, unit_price, line_total, products(name))`
      )
      .eq('id', returnId as string)
      .single() as any);
    throwIfError(fetchError);

    await createAuditLog({
      entityType: 'sale_return',
      entityId: returnId as string,
      action: 'sale_return.created',
      description: `Devolución registrada para venta ${input.saleId}`,
      userId: input.actorUserId,
      ipAddress: input.ipAddress,
      metadata: {
        saleId: input.saleId,
        totalRefund: (saleReturn as any)?.total_refund,
        itemsCount: input.items.length,
      },
    });

    return saleReturn;
  }

  /** Lista todas las devoluciones de una venta específica. */
  async listBySale(saleId: string, storeId: string) {
    const { data, error } = await (this.client
      .from('sale_returns')
      .select(
        `*, users(full_name),
         sale_return_items(id, sale_item_id, product_id, quantity, unit_quantity, unit_price, line_total, products(name))`
      )
      .eq('sale_id', saleId)
      .eq('store_id', storeId)
      .order('created_at', { ascending: false }) as any);
    throwIfError(error);
    return data ?? [];
  }
}

