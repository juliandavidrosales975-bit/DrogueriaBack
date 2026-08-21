import { getSupabaseClient, throwIfError } from '@core/database/connection';
import { generateId } from '@shared/utils/cuid';

export type StoreType = 'PHARMACY' | 'STORE';
export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';

export type Store = {
  id: string;
  name: string;
  nit: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  type: StoreType;
  isActive: boolean;
  subscriptionStatus: SubscriptionStatus;
  trialDays: number;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  daysRemaining: number | null;
  isTrialExpired: boolean;
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
  subscriptionStatus?: SubscriptionStatus;
  trialDays?: number;
  trialEndsAt?: string | null;
};

export type UpdateStoreInput = Partial<CreateStoreInput> & { isActive?: boolean };

const computeTrialInfo = (status: SubscriptionStatus, trialEndsAt: string | null) => {
  if (status === 'ACTIVE') {
    return { isTrialExpired: false, daysRemaining: null };
  }
  if (status === 'EXPIRED' || status === 'SUSPENDED') {
    return { isTrialExpired: true, daysRemaining: 0 };
  }
  // status === 'TRIAL'
  if (!trialEndsAt) {
    return { isTrialExpired: false, daysRemaining: null };
  }
  const diffMs = new Date(trialEndsAt).getTime() - Date.now();
  const daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  const isTrialExpired = diffMs <= 0;
  return { isTrialExpired, daysRemaining };
};

const mapStore = (row: any): Store => {
  const status: SubscriptionStatus = row.subscription_status ?? 'TRIAL';
  const trialEndsAt = row.trial_ends_at ?? null;
  const { isTrialExpired, daysRemaining } = computeTrialInfo(status, trialEndsAt);

  return {
    id: row.id,
    name: row.name,
    nit: row.nit,
    address: row.address,
    phone: row.phone,
    email: row.email,
    type: (row.type as StoreType) ?? 'PHARMACY',
    isActive: row.is_active,
    subscriptionStatus: status,
    trialDays: row.trial_days ?? 15,
    trialStartedAt: row.trial_started_at ?? null,
    trialEndsAt,
    daysRemaining,
    isTrialExpired,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

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
    const trialDays = input.trialDays !== undefined ? Number(input.trialDays) : 15;
    const subscriptionStatus = input.subscriptionStatus ?? 'TRIAL';
    
    let trialEndsAt: string | null = null;
    if (subscriptionStatus === 'TRIAL') {
      if (input.trialEndsAt) {
        trialEndsAt = new Date(input.trialEndsAt).toISOString();
      } else {
        const d = new Date();
        d.setDate(d.getDate() + trialDays);
        trialEndsAt = d.toISOString();
      }
    }

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
        subscription_status: subscriptionStatus,
        trial_days: trialDays,
        trial_started_at: new Date().toISOString(),
        trial_ends_at: trialEndsAt,
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
    if (input.subscriptionStatus !== undefined) payload.subscription_status = input.subscriptionStatus;
    if (input.trialDays !== undefined) payload.trial_days = Number(input.trialDays);
    if (input.trialEndsAt !== undefined) {
      payload.trial_ends_at = input.trialEndsAt ? new Date(input.trialEndsAt).toISOString() : null;
    }

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
