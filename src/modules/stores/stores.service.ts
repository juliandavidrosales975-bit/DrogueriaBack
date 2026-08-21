import { StoresRepository, CreateStoreInput, UpdateStoreInput, SubscriptionStatus } from './stores.repository';
import { ApiError } from '@shared/errors/ApiError';

export class StoresService {
  private storesRepo = new StoresRepository();

  async list() {
    return this.storesRepo.findAll();
  }

  async getById(id: string) {
    const store = await this.storesRepo.findById(id);
    if (!store) throw ApiError.notFound('Establecimiento no encontrado');
    return store;
  }

  async create(input: CreateStoreInput) {
    if (!input.name?.trim()) throw ApiError.badRequest('El nombre del establecimiento es obligatorio');
    return this.storesRepo.create(input);
  }

  async update(id: string, input: UpdateStoreInput) {
    await this.getById(id);
    return this.storesRepo.update(id, input);
  }

  async extendTrial(id: string, additionalDays: number) {
    if (!additionalDays || additionalDays <= 0) {
      throw ApiError.badRequest('La cantidad de días a extender debe ser mayor a 0');
    }
    const store = await this.getById(id);

    // Calcular nueva fecha de vencimiento: a partir de hoy o a partir de la fecha actual si aún no vence
    let baseDate = new Date();
    if (store.trialEndsAt && new Date(store.trialEndsAt) > baseDate) {
      baseDate = new Date(store.trialEndsAt);
    }
    baseDate.setDate(baseDate.getDate() + additionalDays);

    return this.storesRepo.update(id, {
      subscriptionStatus: 'TRIAL',
      trialEndsAt: baseDate.toISOString(),
    });
  }

  async updateSubscription(id: string, input: { subscriptionStatus?: SubscriptionStatus; trialDays?: number; trialEndsAt?: string | null }) {
    await this.getById(id);
    return this.storesRepo.update(id, input);
  }

  async delete(id: string) {
    await this.getById(id);
    try {
      await this.storesRepo.delete(id);
    } catch (err: any) {
      if (err?.code === '23503') {
        throw ApiError.badRequest('No se puede eliminar el establecimiento porque tiene usuarios o datos asociados. Desactívalo en su lugar.');
      }
      throw err;
    }
  }
}
