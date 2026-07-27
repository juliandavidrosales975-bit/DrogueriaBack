import { getSupabaseClient, throwIfError } from '@core/database/connection';
import { generateId } from './cuid';

type AuditInput = {
  entityType: string;
  entityId: string;
  action: string;
  description?: string;
  metadata?: unknown;
  userId?: string;
  ipAddress?: string;
};

export async function createAuditLog(input: AuditInput): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client.from('audit_logs').insert({
    id: generateId(),
    entity_type: input.entityType,
    entity_id: input.entityId,
    action: input.action,
    description: input.description || null,
    metadata: input.metadata ? (input.metadata as object) : null,
    user_id: input.userId || null,
    ip_address: input.ipAddress || null,
  });
  throwIfError(error);
}
