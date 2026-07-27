import { getSupabaseClient, throwIfError } from '@core/database/connection';
import { generateId } from '@shared/utils/cuid';

export type UserRecord = {
  id: string;
  email: string;
  username: string;
  fullName: string;
  status: string;
  roleId: string;
  roleName: string | null;
  storeId: string | null;
  storeName: string | null;
  permissions: string[] | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateUserInput = {
  email: string;
  username: string;
  fullName: string;
  passwordHash: string;
  roleId: string;
  storeId?: string | null;
  permissions?: string[] | null;
  status?: string;
};

export type UpdateUserInput = {
  email?: string;
  username?: string;
  fullName?: string;
  passwordHash?: string;
  roleId?: string;
  storeId?: string | null;
  permissions?: string[] | null;
  status?: string;
};

export type RoleRecord = {
  id: string;
  name: string;
};

const mapUser = (row: any): UserRecord => ({
  id: row.id,
  email: row.email,
  username: row.username,
  fullName: row.full_name,
  status: row.status,
  roleId: row.role_id,
  roleName: row.roles?.name ?? null,
  storeId: row.store_id ?? null,
  storeName: row.stores?.name ?? null,
  permissions: row.permissions ?? null,
  lastLoginAt: row.last_login_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class UsersRepository {
  private get client(): any {
    return getSupabaseClient();
  }

  async findAll(): Promise<UserRecord[]> {
    const { data, error } = await this.client
      .from('users')
      .select('*, roles(name), stores(name)')
      .order('created_at', { ascending: false });
    throwIfError(error);
    return (data ?? []).map(mapUser);
  }

  /** Lista los usuarios (empleados) de una droguería específica. Usado por el Administrador de Drogueria. */
  async findByStoreId(storeId: string): Promise<UserRecord[]> {
    const { data, error } = await this.client
      .from('users')
      .select('*, roles(name), stores(name)')
      .eq('store_id', storeId)
      .order('full_name', { ascending: true });
    throwIfError(error);
    return (data ?? []).map(mapUser);
  }

  async findById(id: string): Promise<UserRecord | null> {
    const { data, error } = await this.client
      .from('users')
      .select('*, roles(name), stores(name)')
      .eq('id', id)
      .maybeSingle();
    throwIfError(error);
    return data ? mapUser(data) : null;
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const { data, error } = await this.client
      .from('users')
      .select('*, roles(name), stores(name)')
      .eq('email', email)
      .maybeSingle();
    throwIfError(error);
    return data ? mapUser(data) : null;
  }

  async findByUsername(username: string): Promise<UserRecord | null> {
    const { data, error } = await this.client
      .from('users')
      .select('*, roles(name), stores(name)')
      .eq('username', username)
      .maybeSingle();
    throwIfError(error);
    return data ? mapUser(data) : null;
  }

  async create(input: CreateUserInput): Promise<UserRecord> {
    const userId = generateId();
    const { error } = await this.client.from('users').insert({
      id: userId,
      email: input.email,
      username: input.username,
      full_name: input.fullName,
      password_hash: input.passwordHash,
      role_id: input.roleId,
      store_id: input.storeId ?? null,
      permissions: input.permissions ?? null,
      status: input.status ?? 'ACTIVE',
    });
    throwIfError(error);

    const created = await this.findById(userId);
    if (!created) throw new Error('User not created');
    return created;
  }

  async update(id: string, input: UpdateUserInput): Promise<UserRecord> {
    const payload: any = { updated_at: new Date().toISOString() };
    if (input.email !== undefined) payload.email = input.email;
    if (input.username !== undefined) payload.username = input.username;
    if (input.fullName !== undefined) payload.full_name = input.fullName;
    if (input.passwordHash !== undefined) payload.password_hash = input.passwordHash;
    if (input.roleId !== undefined) payload.role_id = input.roleId;
    if (input.storeId !== undefined) payload.store_id = input.storeId;
    if (input.permissions !== undefined) payload.permissions = input.permissions;
    if (input.status !== undefined) payload.status = input.status;

    const { error } = await this.client.from('users').update(payload).eq('id', id);
    throwIfError(error);

    const updated = await this.findById(id);
    if (!updated) throw new Error('User not found after update');
    return updated;
  }

  async delete(id: string): Promise<void> {
    await this.client.from('refresh_tokens').update({ is_revoked: true }).eq('user_id', id);
    const { error } = await this.client.from('users').delete().eq('id', id);
    throwIfError(error);
  }

  async getRoles(): Promise<RoleRecord[]> {
    const { data, error } = await this.client
      .from('roles')
      .select('id, name')
      .order('name', { ascending: true });
    throwIfError(error);
    return data ?? [];
  }
}
