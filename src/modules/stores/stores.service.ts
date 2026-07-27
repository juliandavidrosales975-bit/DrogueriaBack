import { StoresRepository } from './stores.repository';
import { ApiError } from '@shared/errors/ApiError';

export class StoresService {
  private storesRepo = new StoresRepository();

  async list() {
    return this.storesRepo.findAll();
  }

  async getById(id: string) {
    const store = await this.storesRepo.findById(id);
    if (!store) throw ApiError.notFound('Droguería no encontrada');
    return store;
  }

  async create(input: { name: string; nit?: string; address?: string; phone?: string; email?: string }) {
    if (!input.name?.trim()) throw ApiError.badRequest('El nombre de la droguería es obligatorio');
    return this.storesRepo.create(input);
  }

  async update(id: string, input: { name?: string; nit?: string; address?: string; phone?: string; email?: string; isActive?: boolean }) {
    await this.getById(id);
    return this.storesRepo.update(id, input);
  }

  async delete(id: string) {
    await this.getById(id);
    // Verificar que no haya usuarios asignados
    // (el constraint de FK lo manejará Supabase, pero damos mensaje amigable)
    try {
      await this.storesRepo.delete(id);
    } catch (err: any) {
      if (err?.code === '23503') {
        throw ApiError.badRequest('No se puede eliminar la droguería porque tiene usuarios o datos asociados. Desactívala en su lugar.');
      }
      throw err;
    }
  }
}
