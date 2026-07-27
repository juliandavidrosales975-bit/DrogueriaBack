import { getSupabaseClient, throwIfError } from '@core/database/connection';
import { generateId } from '@shared/utils/cuid';

export type ProductUnit = {
  id: string;
  productId: string;
  name: string;
  factor: number;
  cost: number;
  price: number;
  barcode: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateProductUnitInput = {
  productId: string;
  name: string;
  factor: number;
  cost: number;
  price: number;
  barcode?: string | null;
  storeId: string;
};

export type UpdateProductUnitInput = Partial<Omit<CreateProductUnitInput, 'productId' | 'storeId'>>;

const mapUnit = (row: any): ProductUnit => ({
  id: row.id,
  productId: row.product_id,
  name: row.name,
  factor: row.factor,
  cost: row.cost,
  price: row.price,
  barcode: row.barcode,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class ProductUnitRepository {
  private get client() {
    return getSupabaseClient();
  }

  async findByProductId(productId: string): Promise<ProductUnit[]> {
    const { data, error } = await this.client
      .from('product_units')
      .select('*')
      .eq('product_id', productId)
      .order('factor', { ascending: true });
    throwIfError(error);
    return (data || []).map(mapUnit);
  }

  async findByProductIds(productIds: string[]): Promise<Record<string, ProductUnit[]>> {
    if (productIds.length === 0) return {};
    const { data, error } = await this.client
      .from('product_units')
      .select('*')
      .in('product_id', productIds)
      .order('factor', { ascending: true });
    throwIfError(error);

    const grouped: Record<string, ProductUnit[]> = {};
    for (const row of data || []) {
      const unit = mapUnit(row);
      grouped[unit.productId] = grouped[unit.productId] || [];
      grouped[unit.productId].push(unit);
    }
    return grouped;
  }

  async findById(id: string): Promise<ProductUnit | null> {
    const { data, error } = await this.client
      .from('product_units')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    throwIfError(error);
    return data ? mapUnit(data) : null;
  }

  async findByBarcode(barcode: string, storeId: string): Promise<ProductUnit | null> {
    const { data, error } = await this.client
      .from('product_units')
      .select('*')
      .eq('barcode', barcode)
      .eq('store_id', storeId)
      .maybeSingle();
    throwIfError(error);
    return data ? mapUnit(data) : null;
  }

  async create(input: CreateProductUnitInput): Promise<ProductUnit> {
    const { data, error } = await this.client
      .from('product_units')
      .insert({
        id: generateId(),
        product_id: input.productId,
        store_id: input.storeId,
        name: input.name,
        factor: input.factor,
        cost: input.cost,
        price: input.price,
        barcode: input.barcode || null,
      })
      .select('*')
      .single();
    throwIfError(error);
    return mapUnit(data);
  }

  async update(id: string, input: UpdateProductUnitInput): Promise<ProductUnit> {
    const payload: Record<string, any> = { updated_at: new Date().toISOString() };
    if (input.name !== undefined) payload.name = input.name;
    if (input.factor !== undefined) payload.factor = input.factor;
    if (input.cost !== undefined) payload.cost = input.cost;
    if (input.price !== undefined) payload.price = input.price;
    if (input.barcode !== undefined) payload.barcode = input.barcode || null;

    const { data, error } = await this.client
      .from('product_units')
      .update(payload)
      .eq('id', id)
      .select('*')
      .single();
    throwIfError(error);
    return mapUnit(data);
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.client.from('product_units').delete().eq('id', id);
    throwIfError(error);
  }

  async deleteAllForProduct(productId: string): Promise<void> {
    const { error } = await this.client.from('product_units').delete().eq('product_id', productId);
    throwIfError(error);
  }
}
