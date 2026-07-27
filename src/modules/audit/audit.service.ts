import { getSupabaseClient, throwIfError } from '@core/database/connection';

type AuditFilters = {
  entityType?: string;
  entityId?: string;
  userId?: string;
  limit?: number;
};

export class AuditService {
  private get client() {
    return getSupabaseClient();
  }

  async list(filters?: AuditFilters) {
    let query = this.client
      .from('audit_logs')
      .select('*, users(full_name)')
      .order('created_at', { ascending: false })
      .limit(filters?.limit || 100);

    if (filters?.entityType) query = query.eq('entity_type', filters.entityType);
    if (filters?.entityId) query = query.eq('entity_id', filters.entityId);
    if (filters?.userId) query = query.eq('user_id', filters.userId);

    const { data, error } = await query;
    throwIfError(error);
    return data;
  }

  async getByEntity(entityType: string, entityId: string) {
    const { data, error } = await this.client
      .from('audit_logs')
      .select('*, users(full_name)')
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .order('created_at', { ascending: false });
    throwIfError(error);
    return data;
  }
}
