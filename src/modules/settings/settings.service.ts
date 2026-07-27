import { getSupabaseClient, throwIfError } from '@core/database/connection';
import { generateId } from '@shared/utils/cuid';
import { ApiError } from '@shared/errors/ApiError';

type Setting = {
  id: string;
  key: string;
  value: string;
  type: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

type CreateSettingInput = {
  key: string;
  value: string;
  type?: string;
  description?: string;
};

const mapSetting = (row: any): Setting => ({
  id: row.id,
  key: row.key,
  value: row.value,
  type: row.type,
  description: row.description,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class SettingsService {
  private get client() {
    return getSupabaseClient();
  }

  async list(storeId: string): Promise<Setting[]> {
    const { data, error } = await this.client
      .from('settings')
      .select('*')
      .eq('store_id', storeId)
      .order('key', { ascending: true });
    throwIfError(error);
    return (data || []).map(mapSetting);
  }

  async getByKey(key: string, storeId: string): Promise<Setting | null> {
    const { data, error } = await this.client
      .from('settings')
      .select('*')
      .eq('key', key)
      .eq('store_id', storeId)
      .maybeSingle();
    throwIfError(error);
    return data ? mapSetting(data) : null;
  }

  async create(input: CreateSettingInput, storeId: string): Promise<Setting> {
    const existing = await this.getByKey(input.key, storeId);
    if (existing) {
      throw ApiError.badRequest('La configuración ya existe');
    }

    const { data, error } = await this.client
      .from('settings')
      .insert({
        id: generateId(),
        store_id: storeId,
        key: input.key,
        value: input.value,
        type: input.type || 'STRING',
        description: input.description || null,
      })
      .select('*')
      .single();
    throwIfError(error);
    return mapSetting(data);
  }

  async update(key: string, value: string, storeId: string): Promise<Setting> {
    const existing = await this.getByKey(key, storeId);
    if (!existing) {
      throw ApiError.notFound('Configuración no encontrada');
    }

    const { data, error } = await this.client
      .from('settings')
      .update({ value, updated_at: new Date().toISOString() })
      .eq('key', key)
      .eq('store_id', storeId)
      .select('*')
      .single();
    throwIfError(error);
    return mapSetting(data);
  }
}
