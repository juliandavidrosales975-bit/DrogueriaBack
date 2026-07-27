import { getSupabaseClient, throwIfError } from '@core/database/connection';
import { generateId } from '@shared/utils/cuid';

export type Category = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateCategoryInput = {
  name: string;
  description?: string | null;
};

const mapCategory = (row: any): Category => ({
  id: row.id,
  name: row.name,
  description: row.description,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class CategoryRepository {
  private get client() {
    return getSupabaseClient();
  }

  async findAll(storeId: string): Promise<Category[]> {
    const { data, error } = await this.client
      .from('product_categories')
      .select('*')
      .eq('store_id', storeId)
      .order('name', { ascending: true });
    throwIfError(error);
    return (data || []).map(mapCategory);
  }

  async findByName(name: string, storeId: string): Promise<Category | null> {
    const { data, error } = await this.client
      .from('product_categories')
      .select('*')
      .ilike('name', name)
      .eq('store_id', storeId)
      .maybeSingle();
    throwIfError(error);
    return data ? mapCategory(data) : null;
  }

  async create(input: CreateCategoryInput, storeId: string): Promise<Category> {
    const { data, error } = await this.client
      .from('product_categories')
      .insert({
        id: generateId(),
        store_id: storeId,
        name: input.name,
        description: input.description || null,
      })
      .select('*')
      .single();
    throwIfError(error);
    return mapCategory(data);
  }
}
