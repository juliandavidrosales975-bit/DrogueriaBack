import bcrypt from 'bcryptjs';
import { UsersRepository } from './users.repository';
import { ApiError } from '@shared/errors/ApiError';
import { env } from '@config/env';
import { createAuditLog } from '@shared/utils/audit';
import { JwtPayload } from '@shared/middlewares/auth.middleware';
import {
  SUPER_ADMIN,
  PHARMACY_ADMIN,
  PHARMACY_CASHIER,
  STORE_ADMIN,
  STORE_SELLER,
} from '@shared/utils/roles';

type CreateUserInput = {
  email: string;
  username: string;
  fullName: string;
  password: string;
  roleId: string;
  storeId?: string | null;
  permissions?: string[] | null;
  status?: string;
  actorUser?: JwtPayload;
  actorUserId?: string;
  ipAddress?: string;
};

type UpdateUserInput = {
  email?: string;
  username?: string;
  fullName?: string;
  password?: string;
  roleId?: string;
  storeId?: string | null;
  permissions?: string[] | null;
  status?: string;
  actorUser?: JwtPayload;
  actorUserId?: string;
  ipAddress?: string;
};

export class UsersService {
  private usersRepo = new UsersRepository();

  async list(actorUser?: JwtPayload) {
    if (actorUser && actorUser.role !== SUPER_ADMIN) {
      if (!actorUser.storeId) return [];
      return this.usersRepo.findByStoreId(actorUser.storeId);
    }
    return this.usersRepo.findAll();
  }

  /** Lista el personal (usuarios) de una droguería o tienda específica. */
  async listByStore(storeId: string) {
    return this.usersRepo.findByStoreId(storeId);
  }

  async getRoles() {
    return this.usersRepo.getRoles();
  }

  async getById(id: string, actorUser?: JwtPayload) {
    const user = await this.usersRepo.findById(id);
    if (!user) throw ApiError.notFound('Usuario no encontrado');
    if (actorUser && actorUser.role !== SUPER_ADMIN) {
      if (user.storeId !== actorUser.storeId) {
        throw ApiError.forbidden('No tienes permiso para ver este usuario');
      }
    }
    return user;
  }

  async create(input: CreateUserInput) {
    let storeIdToAssign = input.storeId;

    if (input.actorUser && input.actorUser.role !== SUPER_ADMIN) {
      const { actorUser } = input;
      if (!actorUser.storeId) {
        throw ApiError.forbidden('No tienes un establecimiento asignado para crear usuarios');
      }
      storeIdToAssign = actorUser.storeId;

      const roles = await this.usersRepo.getRoles();
      const targetRole = roles.find((r) => r.id === input.roleId);
      if (!targetRole) throw ApiError.badRequest('Rol no válido');

      if (actorUser.role === PHARMACY_ADMIN) {
        const allowedRoles = [PHARMACY_CASHIER, PHARMACY_ADMIN];
        if (!allowedRoles.includes(targetRole.name)) {
          throw ApiError.forbidden(
            'Como Administrador de Droguería solo puedes crear cajeros o administradores de droguería',
          );
        }
      } else if (actorUser.role === STORE_ADMIN) {
        const allowedRoles = [STORE_SELLER, STORE_ADMIN];
        if (!allowedRoles.includes(targetRole.name)) {
          throw ApiError.forbidden(
            'Como Administrador de Tienda solo puedes crear vendedores o administradores de tienda',
          );
        }
      } else {
        throw ApiError.forbidden('No tienes permisos para crear usuarios');
      }
    }

    const byEmail = await this.usersRepo.findByEmail(input.email);
    if (byEmail) throw ApiError.badRequest('El correo electrónico ya está en uso');

    const byUsername = await this.usersRepo.findByUsername(input.username);
    if (byUsername) throw ApiError.badRequest('El nombre de usuario ya está en uso');

    const passwordHash = await bcrypt.hash(input.password, env.security.bcryptRounds);

    const user = await this.usersRepo.create({
      email: input.email,
      username: input.username,
      fullName: input.fullName,
      passwordHash,
      roleId: input.roleId,
      storeId: storeIdToAssign ?? null,
      permissions: input.permissions ?? null,
      status: input.status ?? 'ACTIVE',
    });

    await createAuditLog({
      entityType: 'user',
      entityId: user.id,
      action: 'user.created',
      description: `Usuario creado: ${user.email}`,
      userId: input.actorUserId ?? input.actorUser?.id,
      ipAddress: input.ipAddress,
    });

    return user;
  }

  async update(id: string, input: UpdateUserInput) {
    const existing = await this.usersRepo.findById(id);
    if (!existing) throw ApiError.notFound('Usuario no encontrado');

    let storeIdToAssign = input.storeId;

    if (input.actorUser && input.actorUser.role !== SUPER_ADMIN) {
      const { actorUser } = input;
      if (existing.storeId !== actorUser.storeId) {
        throw ApiError.forbidden('No tienes permiso para modificar este usuario');
      }
      storeIdToAssign = actorUser.storeId;

      if (input.roleId) {
        const roles = await this.usersRepo.getRoles();
        const targetRole = roles.find((r) => r.id === input.roleId);
        if (!targetRole) throw ApiError.badRequest('Rol no válido');

        if (actorUser.role === PHARMACY_ADMIN) {
          const allowedRoles = [PHARMACY_CASHIER, PHARMACY_ADMIN];
          if (!allowedRoles.includes(targetRole.name)) {
            throw ApiError.forbidden('Solo puedes asignar roles de Cajero o Administrador de Droguería');
          }
        } else if (actorUser.role === STORE_ADMIN) {
          const allowedRoles = [STORE_SELLER, STORE_ADMIN];
          if (!allowedRoles.includes(targetRole.name)) {
            throw ApiError.forbidden('Solo puedes asignar roles de Vendedor o Administrador de Tienda');
          }
        } else {
          throw ApiError.forbidden('No tienes permisos para modificar roles');
        }
      }
    }

    if (input.email && input.email !== existing.email) {
      const byEmail = await this.usersRepo.findByEmail(input.email);
      if (byEmail) throw ApiError.badRequest('El correo electrónico ya está en uso');
    }

    if (input.username && input.username !== existing.username) {
      const byUsername = await this.usersRepo.findByUsername(input.username);
      if (byUsername) throw ApiError.badRequest('El nombre de usuario ya está en uso');
    }

    let passwordHash: string | undefined;
    if (input.password) {
      passwordHash = await bcrypt.hash(input.password, env.security.bcryptRounds);
    }

    const user = await this.usersRepo.update(id, {
      email: input.email,
      username: input.username,
      fullName: input.fullName,
      passwordHash,
      roleId: input.roleId,
      storeId: storeIdToAssign,
      permissions: input.permissions,
      status: input.status,
    });

    await createAuditLog({
      entityType: 'user',
      entityId: user.id,
      action: 'user.updated',
      description: `Usuario actualizado: ${user.email}`,
      userId: input.actorUserId ?? input.actorUser?.id,
      ipAddress: input.ipAddress,
    });

    return user;
  }

  async delete(id: string, actorUser?: JwtPayload, ipAddress?: string) {
    const existing = await this.usersRepo.findById(id);
    if (!existing) throw ApiError.notFound('Usuario no encontrado');

    if (actorUser) {
      if (actorUser.id === id) {
        throw ApiError.badRequest('No puedes eliminar tu propio usuario');
      }

      if (actorUser.role !== SUPER_ADMIN) {
        if (existing.storeId !== actorUser.storeId) {
          throw ApiError.forbidden('No tienes permiso para eliminar este usuario');
        }
      }
    }

    await this.usersRepo.delete(id);

    await createAuditLog({
      entityType: 'user',
      entityId: id,
      action: 'user.deleted',
      description: `Usuario eliminado: ${existing.email}`,
      userId: actorUser?.id,
      ipAddress,
    });
  }
}

