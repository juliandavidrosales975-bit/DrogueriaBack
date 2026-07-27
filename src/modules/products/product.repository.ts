import { getSupabaseClient, throwIfError } from '@core/database/connection';
import { generateId } from '@shared/utils/cuid';

export type Product = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  categoryId: string | null;
  cost: number;
  price: number;
  stock: number;
  minStock: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProductUnitSummary = {
  id: string;
  name: string;
  factor: number;
  cost: number;
  price: number;
  barcode: string | null;
};

export type ProductWithCategory = Product & {
  categoryName: string | null;
  units: ProductUnitSummary[];
};

export type CreateProductInput = {
  sku: string;
  barcode?: string | null;
  name: string;
  description?: string | null;
  categoryId?: string | null;
  cost: number;
  price: number;
  minStock?: number;
  isActive?: boolean;
  initialStock?: number;
};

export type UpdateProductInput = Partial<CreateProductInput>;

const mapProduct = (row: any): ProductWithCategory => ({
  id: row.id,
  sku: row.sku,
  barcode: row.barcode,
  name: row.name,
  description: row.description,
  categoryId: row.category_id,
  cost: row.cost,
  price: row.price,
  stock: row.stock,
  minStock: row.min_stock,
  isActive: row.is_active,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  categoryName: row.product_categories?.name ?? null,
  units: (row.product_units || []).map((u: any) => ({
    id: u.id,
    name: u.name,
    factor: u.factor,
    cost: u.cost,
    price: u.price,
    barcode: u.barcode,
  })),
});

export class ProductRepository {
  private get client() {
    return getSupabaseClient();
  }

  async findAll(storeId: string): Promise<ProductWithCategory[]> {
    const { data, error } = await this.client
      .from('products')
      .select('*, product_categories(name), product_units(*)')
      .eq('store_id', storeId)
      .order('created_at', { ascending: false });
    throwIfError(error);
    return (data || []).map(mapProduct);
  }

  async findLowStock(storeId: string): Promise<ProductWithCategory[]> {
    const { data, error } = await this.client
      .from('products')
      .select('*, product_categories(name), product_units(*)')
      .eq('store_id', storeId)
      .order('stock', { ascending: true });
    throwIfError(error);
    return (data || []).map(mapProduct).filter((p) => p.stock <= p.minStock);
  }

  async findById(id: string, storeId: string): Promise<ProductWithCategory | null> {
    const { data, error } = await this.client
      .from('products')
      .select('*, product_categories(name), product_units(*)')
      .eq('id', id)
      .eq('store_id', storeId)
      .maybeSingle();
    throwIfError(error);
    return data ? mapProduct(data) : null;
  }

  async findBySku(sku: string, storeId: string): Promise<Product | null> {
    const { data, error } = await this.client
      .from('products')
      .select('*')
      .eq('sku', sku)
      .eq('store_id', storeId)
      .maybeSingle();
    throwIfError(error);
    return data ? mapProduct(data) : null;
  }

  async create(input: CreateProductInput, storeId: string): Promise<Product> {
    const id = generateId();
    const { data, error } = await this.client
      .from('products')
      .insert({
        id,
        store_id: storeId,
        sku: input.sku,
        barcode: input.barcode || null,
        name: input.name,
        description: input.description || null,
        category_id: input.categoryId || null,
        cost: input.cost,
        price: input.price,
        stock: input.initialStock && input.initialStock > 0 ? input.initialStock : 0,
        min_stock: input.minStock || 0,
        is_active: input.isActive !== undefined ? input.isActive : true,
      })
      .select('*')
      .single();
    throwIfError(error);

    if (input.initialStock && input.initialStock > 0) {
      const { error: movementError } = await this.client.from('stock_movements').insert({
        id: generateId(),
        product_id: id,
        store_id: storeId,
        type: 'ADJUSTMENT',
        quantity: input.initialStock,
        note: 'Stock inicial al crear el producto',
        reference_type: 'product',
        reference_id: id,
      });
      throwIfError(movementError);
    }

    return mapProduct(data);
  }

  async update(id: string, input: UpdateProductInput, storeId: string): Promise<Product> {
    const payload: Record<string, any> = { updated_at: new Date().toISOString() };
    if (input.sku !== undefined) payload.sku = input.sku;
    if (input.barcode !== undefined) payload.barcode = input.barcode;
    if (input.name !== undefined) payload.name = input.name;
    if (input.description !== undefined) payload.description = input.description;
    if (input.categoryId !== undefined) payload.category_id = input.categoryId;
    if (input.cost !== undefined) payload.cost = input.cost;
    if (input.price !== undefined) payload.price = input.price;
    if (input.minStock !== undefined) payload.min_stock = input.minStock;
    if (input.isActive !== undefined) payload.is_active = input.isActive;

    const { data, error } = await this.client
      .from('products')
      .update(payload)
      .eq('id', id)
      .eq('store_id', storeId)
      .select('*')
      .single();
    throwIfError(error);
    return mapProduct(data);
  }

  async updateStock(productId: string, quantity: number, isIncrement: boolean): Promise<void> {
    const { data, error } = await this.client
      .from('products')
      .select('stock')
      .eq('id', productId)
      .single();
    throwIfError(error);

    const currentStock = (data as any)?.stock ?? 0;
    const newStock = isIncrement ? currentStock + Math.abs(quantity) : currentStock - Math.abs(quantity);

    const { error: updateError } = await this.client
      .from('products')
      .update({ stock: newStock, updated_at: new Date().toISOString() })
      .eq('id', productId);
    throwIfError(updateError);
  }

  /**
   * Ajusta el stock a un valor exacto y registra el movimiento de inventario.
   */
  async setStock(productId: string, newStock: number, storeId: string, note?: string): Promise<Product> {
    const current = await this.findById(productId, storeId);
    if (!current) {
      throw new Error('Producto no encontrado');
    }

    const delta = newStock - current.stock;

    const { data, error } = await this.client
      .from('products')
      .update({ stock: newStock, updated_at: new Date().toISOString() })
      .eq('id', productId)
      .eq('store_id', storeId)
      .select('*')
      .single();
    throwIfError(error);

    if (delta !== 0) {
      const { error: movementError } = await this.client.from('stock_movements').insert({
        id: generateId(),
        product_id: productId,
        store_id: storeId,
        type: 'ADJUSTMENT',
        quantity: Math.abs(delta),
        note: note || `Ajuste manual de inventario (${delta > 0 ? '+' : ''}${delta})`,
        reference_type: 'product',
        reference_id: productId,
      });
      throwIfError(movementError);
    }

    return mapProduct(data);
  }

  /**
   * Elimina el producto. Las llaves foráneas de sale_items, purchase_items y
   * stock_movements están configuradas con ON DELETE CASCADE (ver migración
   * 013_allow_product_delete_cascade.sql), por lo que también se eliminan
   * automáticamente sus líneas de venta/compra y movimientos de inventario
   * asociados. Esta operación es irreversible y afecta el histórico.
   */
  async delete(productId: string, storeId: string): Promise<void> {
    const { error } = await this.client.from('products').delete().eq('id', productId).eq('store_id', storeId);
    throwIfError(error);
  }
}
