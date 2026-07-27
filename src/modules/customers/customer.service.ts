import { CustomerRepository, CreateCustomerInput, UpdateCustomerInput } from './customer.repository';
import { ApiError } from '@shared/errors/ApiError';
import { createAuditLog } from '@shared/utils/audit';

type CustomerInputWithAudit = CreateCustomerInput & {
  actorUserId?: string;
  ipAddress?: string;
  storeId: string;
};

type UpdateCustomerInputWithAudit = UpdateCustomerInput & {
  actorUserId?: string;
  ipAddress?: string;
  storeId: string;
};

export class CustomerService {
  private customerRepo = new CustomerRepository();

  async list(storeId: string) {
    return this.customerRepo.findAll(storeId);
  }

  async create(input: CustomerInputWithAudit) {
    const existing = await this.customerRepo.findByCode(input.code, input.storeId);
    if (existing) {
      throw ApiError.badRequest('El código ya está en uso');
    }

    const customer = await this.customerRepo.create(input, input.storeId);

    await createAuditLog({
      entityType: 'customer',
      entityId: customer.id,
      action: 'customer.created',
      description: 'Cliente creado',
      userId: input.actorUserId,
      ipAddress: input.ipAddress,
    });

    return customer;
  }

  async update(customerId: string, input: UpdateCustomerInputWithAudit) {
    const existing = await this.customerRepo.findById(customerId, input.storeId);
    if (!existing) {
      throw ApiError.notFound('Cliente no encontrado');
    }

    if (input.code && input.code !== existing.code) {
      const codeExists = await this.customerRepo.findByCode(input.code, input.storeId);
      if (codeExists) {
        throw ApiError.badRequest('El código ya está en uso');
      }
    }

    const customer = await this.customerRepo.update(customerId, input, input.storeId);

    await createAuditLog({
      entityType: 'customer',
      entityId: customer.id,
      action: 'customer.updated',
      description: 'Cliente actualizado',
      userId: input.actorUserId,
      ipAddress: input.ipAddress,
    });

    return customer;
  }
}
