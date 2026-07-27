import { SupplierRepository, CreateSupplierInput, UpdateSupplierInput } from './supplier.repository';
import { ApiError } from '@shared/errors/ApiError';
import { createAuditLog } from '@shared/utils/audit';

type SupplierInputWithAudit = CreateSupplierInput & {
  actorUserId?: string;
  ipAddress?: string;
  storeId: string;
};

type UpdateSupplierInputWithAudit = UpdateSupplierInput & {
  actorUserId?: string;
  ipAddress?: string;
  storeId: string;
};

export class SupplierService {
  private supplierRepo = new SupplierRepository();

  async list(storeId: string) {
    return this.supplierRepo.findAll(storeId);
  }

  async create(input: SupplierInputWithAudit) {
    const existing = await this.supplierRepo.findByCode(input.code, input.storeId);
    if (existing) {
      throw ApiError.badRequest('El código ya está en uso');
    }

    const supplier = await this.supplierRepo.create(input, input.storeId);

    await createAuditLog({
      entityType: 'supplier',
      entityId: supplier.id,
      action: 'supplier.created',
      description: 'Proveedor creado',
      userId: input.actorUserId,
      ipAddress: input.ipAddress,
    });

    return supplier;
  }

  async update(supplierId: string, input: UpdateSupplierInputWithAudit) {
    const existing = await this.supplierRepo.findById(supplierId, input.storeId);
    if (!existing) {
      throw ApiError.notFound('Proveedor no encontrado');
    }

    if (input.code && input.code !== existing.code) {
      const codeExists = await this.supplierRepo.findByCode(input.code, input.storeId);
      if (codeExists) {
        throw ApiError.badRequest('El código ya está en uso');
      }
    }

    const supplier = await this.supplierRepo.update(supplierId, input, input.storeId);

    await createAuditLog({
      entityType: 'supplier',
      entityId: supplier.id,
      action: 'supplier.updated',
      description: 'Proveedor actualizado',
      userId: input.actorUserId,
      ipAddress: input.ipAddress,
    });

    return supplier;
  }
}
