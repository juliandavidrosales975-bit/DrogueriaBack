import { getSupabaseClient, throwIfError } from '@core/database/connection';
import { generateId } from '@shared/utils/cuid';

export type Customer = {
  id: string;
  code: string;
  fullName: string;
  document: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateCustomerInput = {
  code: string;
  fullName: string;
  document?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
};

export type UpdateCustomerInput = Partial<CreateCustomerInput>;

const mapCustomer = (row: any): Customer => ({
  id: row.id,
  code: row.code,
  fullName: row.full_name,
  document: row.document,
  phone: row.phone,
  email: row.email,
  address: row.address,
  notes: row.notes,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class CustomerRepository {
  private get client() {
    return getSupabaseClient();
  }

  async findAll(storeId: string): Promise<Customer[]> {
    const { data, error } = await this.client
      .from('customers')
      .select('*')
      .eq('store_id', storeId)
      .order('created_at', { ascending: false });
    throwIfError(error);
    return (data || []).map(mapCustomer);
  }

  async findById(id: string, storeId: string): Promise<Customer | null> {
    const { data, error } = await this.client
      .from('customers')
      .select('*')
      .eq('id', id)
      .eq('store_id', storeId)
      .maybeSingle();
    throwIfError(error);
    return data ? mapCustomer(data) : null;
  }

  async findByCode(code: string, storeId: string): Promise<Customer | null> {
    const { data, error } = await this.client
      .from('customers')
      .select('*')
      .eq('code', code)
      .eq('store_id', storeId)
      .maybeSingle();
    throwIfError(error);
    return data ? mapCustomer(data) : null;
  }

  async create(input: CreateCustomerInput, storeId: string): Promise<Customer> {
    const id = generateId();
    const { data, error } = await this.client
      .from('customers')
      .insert({
        id,
        store_id: storeId,
        code: input.code,
        full_name: input.fullName,
        document: input.document || null,
        phone: input.phone || null,
        email: input.email || null,
        address: input.address || null,
        notes: input.notes || null,
      })
      .select('*')
      .single();
    throwIfError(error);
    return mapCustomer(data);
  }

  async update(id: string, input: UpdateCustomerInput, storeId: string): Promise<Customer> {
    const payload: Record<string, any> = { updated_at: new Date().toISOString() };
    if (input.code !== undefined) payload.code = input.code;
    if (input.fullName !== undefined) payload.full_name = input.fullName;
    if (input.document !== undefined) payload.document = input.document;
    if (input.phone !== undefined) payload.phone = input.phone;
    if (input.email !== undefined) payload.email = input.email;
    if (input.address !== undefined) payload.address = input.address;
    if (input.notes !== undefined) payload.notes = input.notes;

    const { data, error } = await this.client
      .from('customers')
      .update(payload)
      .eq('id', id)
      .eq('store_id', storeId)
      .select('*')
      .single();
    throwIfError(error);
    return mapCustomer(data);
  }
}
