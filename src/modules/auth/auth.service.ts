import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AuthRepository } from './auth.repository';
import { ApiError } from '@shared/errors/ApiError';
import { env } from '@config/env';
import { generateId } from '@shared/utils/cuid';
import { getSupabaseClient } from '@core/database/connection';

export class AuthService {
  private authRepo = new AuthRepository();

  async login(email: string, password: string, ipAddress?: string, userAgent?: string) {
    const user = await this.authRepo.findUserByEmail(email);

    // Registro de intento fallido
    if (!user) {
      await this.authRepo.createLoginAttempt({
        email,
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
        success: false,
        reason: 'Usuario no encontrado',
        userId: null,
      });
      throw ApiError.unauthorized('Credenciales inválidas');
    }

    // Verificar si está bloqueado
    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      throw ApiError.unauthorized('Usuario bloqueado temporalmente');
    }

    // Verificar contraseña
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    
    if (!isValidPassword) {
      await this.authRepo.incrementFailedAttempts(user.id);
      
      const newAttempts = user.failedLoginAttempts + 1;
      if (newAttempts >= env.security.maxLoginAttempts) {
        const lockUntil = new Date(Date.now() + env.security.lockDurationMinutes * 60000);
        await this.authRepo.lockUser(user.id, lockUntil);
      }

      await this.authRepo.createLoginAttempt({
        email,
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
        success: false,
        reason: 'Contraseña incorrecta',
        userId: user.id,
      });

      throw ApiError.unauthorized('Credenciales inválidas');
    }

    // Login exitoso
    await this.authRepo.updateUserLastLogin(user.id);
    await this.authRepo.createLoginAttempt({
      email,
      ipAddress: ipAddress || null,
      userAgent: userAgent || null,
      success: true,
      reason: null,
      userId: user.id,
    });

    // Generar tokens
    const userWithRole = await this.authRepo.getUserWithRole(user.id);
    if (!userWithRole) throw ApiError.internal();

    const accessToken = this.generateAccessToken(userWithRole);
    const refreshToken = await this.generateRefreshToken(userWithRole.id);

    return {
      user: {
        id: userWithRole.id,
        email: userWithRole.email,
        username: userWithRole.username,
        fullName: userWithRole.fullName,
        role: userWithRole.roleName,
        storeId: userWithRole.storeId,
        storeName: userWithRole.storeName,
        storeType: userWithRole.storeType,
        permissions: userWithRole.permissions ?? null,
      },
      accessToken,
      refreshToken,
    };
  }

  private generateAccessToken(user: {
    id: string;
    email: string;
    roleName: string | null;
    storeId: string | null;
    storeName: string | null;
    storeType: string | null;
    permissions?: string[] | null;
  }): string {
    return jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.roleName || 'Cajero',
        storeId: user.storeId ?? null,
        storeName: user.storeName ?? null,
        storeType: user.storeType ?? null,
        permissions: user.permissions ?? null,
      },
      env.jwt.secret,
      { expiresIn: env.jwt.accessExpiration as any },
    );
  }

  private async generateRefreshToken(userId: string): Promise<string> {
    const token = generateId();
    const tokenHash = await bcrypt.hash(token, 5);
    const family = generateId();

    await this.authRepo.createRefreshToken({
      id: generateId(),
      userId,
      tokenHash,
      family,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 días
      isRevoked: false,
      revokedAt: null,
    });

    return jwt.sign({ userId, token }, env.jwt.secret);
  }

  private async generateRefreshTokenInFamily(userId: string, family: string): Promise<string> {
    const token = generateId();
    const tokenHash = await bcrypt.hash(token, 5);

    await this.authRepo.createRefreshToken({
      id: generateId(),
      userId,
      tokenHash,
      family,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 días
      isRevoked: false,
      revokedAt: null,
    });

    return jwt.sign({ userId, token }, env.jwt.secret);
  }

  async getMe(userId: string) {
    const user = await this.authRepo.getUserWithRole(userId);
    if (!user) throw ApiError.unauthorized('Usuario no encontrado');
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      fullName: user.fullName,
      role: user.roleName,
      storeId: user.storeId,
      storeName: user.storeName,
      storeType: user.storeType,
      permissions: user.permissions ?? null,
    };
  }

  async logout(refreshToken: string): Promise<void> {
    try {
      const decoded = jwt.verify(refreshToken, env.jwt.secret) as { userId: string; token: string };
      const client = getSupabaseClient() as any;
      const { data: tokens } = await client
        .from('refresh_tokens')
        .select('*')
        .eq('user_id', decoded.userId)
        .eq('is_revoked', false);

      if (tokens) {
        for (const t of tokens) {
          const match = await bcrypt.compare(decoded.token, t.token_hash);
          if (match) {
            await this.authRepo.revokeFamilyTokens(decoded.userId, t.family);
            break;
          }
        }
      }
    } catch {
      // Ignorar errores al verificar el token durante el logout
    }
  }

  async refresh(refreshToken: string) {
    try {
      const decoded = jwt.verify(refreshToken, env.jwt.secret) as { userId: string; token: string };
      const client = getSupabaseClient() as any;
      const { data: tokens, error } = await client
        .from('refresh_tokens')
        .select('*')
        .eq('user_id', decoded.userId)
        .eq('is_revoked', false);

      if (error || !tokens) {
        throw ApiError.unauthorized('Token no válido');
      }

      let activeToken = null;
      for (const t of tokens) {
        const match = await bcrypt.compare(decoded.token, t.token_hash);
        if (match) {
          activeToken = t;
          break;
        }
      }

      if (!activeToken) {
        // Posible robo de token. Revocar toda la familia
        const { data: anyTokens } = await client
          .from('refresh_tokens')
          .select('*')
          .eq('user_id', decoded.userId);

        if (anyTokens) {
          for (const t of anyTokens) {
            const match = await bcrypt.compare(decoded.token, t.token_hash);
            if (match) {
              await this.authRepo.revokeFamilyTokens(decoded.userId, t.family);
              break;
            }
          }
        }
        throw ApiError.unauthorized('Acceso denegado - Reutilización de token detectada');
      }

      if (new Date(activeToken.expires_at) < new Date()) {
        await this.authRepo.revokeFamilyTokens(decoded.userId, activeToken.family);
        throw ApiError.unauthorized('Refresh token expirado');
      }

      const user = await this.authRepo.getUserWithRole(decoded.userId);
      if (!user) throw ApiError.unauthorized('Usuario no encontrado');

      // Rotar tokens
      await this.authRepo.revokeFamilyTokens(decoded.userId, activeToken.family);

      const newAccessToken = this.generateAccessToken(user);
      const newRefreshToken = await this.generateRefreshTokenInFamily(user.id, activeToken.family);

      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          fullName: user.fullName,
          role: user.roleName,
        },
      };
    } catch (err: any) {
      if (err instanceof ApiError) throw err;
      throw ApiError.unauthorized('Token no válido');
    }
  }
}
