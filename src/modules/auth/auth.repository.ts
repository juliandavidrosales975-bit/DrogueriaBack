import { getSupabaseClient, throwIfError } from '@core/database/connection';
import { generateId } from '@shared/utils/cuid';

export type UserWithRole = {
  id: string;
  email: string;
  username: string;
  fullName: string;
  passwordHash: string;
  status: string;
  failedLoginAttempts: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  roleId: string;
  roleName: string | null;
  storeId: string | null;
  storeName: string | null;
  storeType: 'PHARMACY' | 'STORE' | null;
  permissions: string[] | null;
  createdAt: string;
  updatedAt: string;
};

type LoginAttemptInput = {
  email: string;
  success: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
  reason?: string | null;
  userId?: string | null;
};

type CreateRefreshTokenInput = {
  id: string;
  userId: string;
  tokenHash: string;
  family: string;
  expiresAt: Date;
  isRevoked: boolean;
  revokedAt: Date | null;
};

const mapUser = (row: any): UserWithRole => ({
  id: row.id,
  email: row.email,
  username: row.username,
  fullName: row.full_name,
  passwordHash: row.password_hash,
  status: row.status,
  failedLoginAttempts: row.failed_login_attempts,
  lockedUntil: row.locked_until,
  lastLoginAt: row.last_login_at,
  roleId: row.role_id,
  roleName: row.roles?.name ?? null,
  storeId: row.store_id ?? null,
  storeName: row.stores?.name ?? null,
  storeType: (row.stores?.type as 'PHARMACY' | 'STORE') ?? null,
  permissions: row.permissions ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class AuthRepository {
  private get client(): any {
    return getSupabaseClient();
  }

  async findUserByEmail(email: string): Promise<UserWithRole | null> {
    const { data, error } = await this.client
      .from('users')
      .select('*, roles(name), stores(name, type)')
      .eq('email', email)
      .maybeSingle();

    throwIfError(error);
    return data ? mapUser(data) : null;
  }

  async getUserWithRole(userId: string): Promise<UserWithRole | null> {
    const { data, error } = await this.client
      .from('users')
      .select('*, roles(name), stores(name, type)')
      .eq('id', userId)
      .maybeSingle();

    throwIfError(error);
    return data ? mapUser(data) : null;
  }

  async incrementFailedAttempts(userId: string): Promise<void> {
    const { data, error } = await this.client
      .from('users')
      .select('failed_login_attempts')
      .eq('id', userId)
      .single();
    throwIfError(error);

    const newValue = (data?.failed_login_attempts ?? 0) + 1;

    const { error: updateError } = await this.client
      .from('users')
      .update({ failed_login_attempts: newValue, updated_at: new Date().toISOString() })
      .eq('id', userId);
    throwIfError(updateError);
  }

  async lockUser(userId: string, lockUntil: Date): Promise<void> {
    const { error } = await this.client
      .from('users')
      .update({ locked_until: lockUntil.toISOString(), updated_at: new Date().toISOString() })
      .eq('id', userId);
    throwIfError(error);
  }

  async updateUserLastLogin(userId: string): Promise<void> {
    const { error } = await this.client
      .from('users')
      .update({
        last_login_at: new Date().toISOString(),
        failed_login_attempts: 0,
        locked_until: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);
    throwIfError(error);
  }

  async createLoginAttempt(input: LoginAttemptInput): Promise<void> {
    const { error } = await this.client.from('login_attempts').insert({
      id: generateId(),
      email: input.email,
      ip_address: input.ipAddress || null,
      user_agent: input.userAgent || null,
      success: input.success,
      reason: input.reason || null,
      user_id: input.userId || null,
    });
    throwIfError(error);
  }

  async createRefreshToken(input: CreateRefreshTokenInput): Promise<void> {
    const { error } = await this.client.from('refresh_tokens').insert({
      id: input.id,
      user_id: input.userId,
      token_hash: input.tokenHash,
      family: input.family,
      expires_at: input.expiresAt.toISOString(),
      is_revoked: input.isRevoked,
      revoked_at: input.revokedAt ? input.revokedAt.toISOString() : null,
    });
    throwIfError(error);
  }

  async findRefreshToken(userId: string, tokenHash: string) {
    const { data, error } = await this.client
      .from('refresh_tokens')
      .select('*')
      .eq('user_id', userId)
      .eq('token_hash', tokenHash)
      .eq('is_revoked', false)
      .maybeSingle();
    throwIfError(error);
    return data;
  }

  async revokeFamilyTokens(userId: string, family: string): Promise<void> {
    const { error } = await this.client
      .from('refresh_tokens')
      .update({ is_revoked: true, revoked_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('family', family)
      .eq('is_revoked', false);
    throwIfError(error);
  }

  async createUser(input: {
    email: string;
    username: string;
    fullName: string;
    passwordHash: string;
    roleName?: string;
  }): Promise<UserWithRole> {
    const { data: role, error: roleError } = await this.client
      .from('roles')
      .select('id')
      .eq('name', input.roleName || 'Cajero')
      .maybeSingle();
    throwIfError(roleError);
    if (!role) throw new Error('Role not found');

    const userId = generateId();
    const { error: insertError } = await this.client.from('users').insert({
      id: userId,
      email: input.email,
      username: input.username,
      full_name: input.fullName,
      password_hash: input.passwordHash,
      role_id: (role as any).id,
      status: 'ACTIVE',
    });
    throwIfError(insertError);

    const created = await this.getUserWithRole(userId);
    if (!created) throw new Error('User not created');
    return created;
  }
}
