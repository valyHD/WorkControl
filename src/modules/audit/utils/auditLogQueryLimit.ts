export const DEFAULT_AUDIT_LOG_QUERY_LIMIT = 10;
export const MAX_AUDIT_LOG_QUERY_LIMIT = 1000;

export function normalizeAuditLogQueryLimit(maxItems: number): number {
  if (!Number.isFinite(maxItems)) return DEFAULT_AUDIT_LOG_QUERY_LIMIT;
  return Math.max(1, Math.min(MAX_AUDIT_LOG_QUERY_LIMIT, Math.floor(maxItems)));
}
