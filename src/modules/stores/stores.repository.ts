import { getSupabaseClient, throwIfError } from '@core/database/connection';
import { generateId } from '@shared/utils/cuid';

export type StoreType = 'PHARMACY' | 'STORE';

export type Store = {
  id: string;
  name: string;
  nit: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  type: StoreType;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CreateStoreInput = {
  name: string;
  nit?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  type?: StoreType;
};

export type UpdateStoreInput = Partial<CreateStoreInput> & { isActive?: boolean };

const mapStore = (row: any): Store => ({
  id: row.id,
  name: row.name,
  nit: row.nit,
  address: row.address,
  phone: row.phone,
  email: row.email,
  type: (row.type as StoreType) ?? 'PHARMACY',
  isActive: row.is_active,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class StoresRepository {
  private get client(): any {
    return getSupabaseClient();
  }

  async findAll(): Promise<Store[]> {
    const { data, error } = await this.client
      .from('stores')
      .select('*')
      .order('name', { ascending: true });
    throwIfError(error);
    return (data ?? []).map(mapStore);
  }

  async findById(id: string): Promise<Store | null> {
    const { data, error } = await this.client
      .from('stores')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    throwIfError(error);
    return data ? mapStore(data) : null;
  }

  async create(input: CreateStoreInput): Promise<Store> {
    const id = generateId();
    const { data, error } = await this.client
      .from('stores')
      .insert({
        id,
        name: input.name,
        nit: input.nit ?? null,
        address: input.address ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        type: input.type ?? 'PHARMACY',
        is_active: true,
      })
      .select('*')
      .single();
    throwIfError(error);
    return mapStore(data);
  }

  async update(id: string, input: UpdateStoreInput): Promise<Store> {
    const payload: any = { updated_at: new Date().toISOString() };
    if (input.name !== undefined) payload.name = input.name;
    if (input.nit !== undefined) payload.nit = input.nit;
    if (input.address !== undefined) payload.address = input.address;
    if (input.phone !== undefined) payload.phone = input.phone;
    if (input.email !== undefined) payload.email = input.email;
    if (input.type !== undefined) payload.type = input.type;
    if (input.isActive !== undefined) payload.is_active = input.isActive;

    const { data, error } = await this.client
      .from('stores')
      .update(payload)
      .eq('id', id)
      .select('*')
      .single();
    throwIfError(error);
    return mapStore(data);
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.client.from('stores').delete().eq('id', id);
    throwIfError(error);
  }
}
