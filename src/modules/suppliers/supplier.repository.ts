import { getSupabaseClient, throwIfError } from '@core/database/connection';
import { generateId } from '@shared/utils/cuid';

export type Supplier = {
  id: string;
  code: string;
  businessName: string;
  taxId: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateSupplierInput = {
  code: string;
  businessName: string;
  taxId?: string | null;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
};

export type UpdateSupplierInput = Partial<CreateSupplierInput>;

const mapSupplier = (row: any): Supplier => ({
  id: row.id,
  code: row.code,
  businessName: row.business_name,
  taxId: row.tax_id,
  contactName: row.contact_name,
  phone: row.phone,
  email: row.email,
  address: row.address,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class SupplierRepository {
  private get client() {
    return getSupabaseClient();
  }

  async findAll(storeId: string): Promise<Supplier[]> {
    const { data, error } = await this.client
      .from('suppliers')
      .select('*')
      .eq('store_id', storeId)
      .order('created_at', { ascending: false });
    throwIfError(error);
    return (data || []).map(mapSupplier);
  }

  async findById(id: string, storeId: string): Promise<Supplier | null> {
    const { data, error } = await this.client
      .from('suppliers')
      .select('*')
      .eq('id', id)
      .eq('store_id', storeId)
      .maybeSingle();
    throwIfError(error);
    return data ? mapSupplier(data) : null;
  }

  async findByCode(code: string, storeId: string): Promise<Supplier | null> {
    const { data, error } = await this.client
      .from('suppliers')
      .select('*')
      .eq('code', code)
      .eq('store_id', storeId)
      .maybeSingle();
    throwIfError(error);
    return data ? mapSupplier(data) : null;
  }

  async create(input: CreateSupplierInput, storeId: string): Promise<Supplier> {
    const id = generateId();
    const { data, error } = await this.client
      .from('suppliers')
      .insert({
        id,
        store_id: storeId,
        code: input.code,
        business_name: input.businessName,
        tax_id: input.taxId || null,
        contact_name: input.contactName || null,
        phone: input.phone || null,
        email: input.email || null,
        address: input.address || null,
      })
      .select('*')
      .single();
    throwIfError(error);
    return mapSupplier(data);
  }

  async update(id: string, input: UpdateSupplierInput, storeId: string): Promise<Supplier> {
    const payload: Record<string, any> = { updated_at: new Date().toISOString() };
    if (input.code !== undefined) payload.code = input.code;
    if (input.businessName !== undefined) payload.business_name = input.businessName;
    if (input.taxId !== undefined) payload.tax_id = input.taxId;
    if (input.contactName !== undefined) payload.contact_name = input.contactName;
    if (input.phone !== undefined) payload.phone = input.phone;
    if (input.email !== undefined) payload.email = input.email;
    if (input.address !== undefined) payload.address = input.address;

    const { data, error } = await this.client
      .from('suppliers')
      .update(payload)
      .eq('id', id)
      .eq('store_id', storeId)
      .select('*')
      .single();
    throwIfError(error);
    return mapSupplier(data);
  }
}
