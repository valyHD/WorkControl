import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUDIT_LOG_QUERY_LIMIT,
  MAX_AUDIT_LOG_QUERY_LIMIT,
  normalizeAuditLogQueryLimit,
} from "./auditLogQueryLimit";

describe("normalizeAuditLogQueryLimit", () => {
  it("keeps requested limits inside the supported range", () => {
    expect(normalizeAuditLogQueryLimit(10)).toBe(10);
    expect(normalizeAuditLogQueryLimit(500)).toBe(500);
    expect(normalizeAuditLogQueryLimit(MAX_AUDIT_LOG_QUERY_LIMIT)).toBe(1000);
  });

  it("caps expensive or invalid requests", () => {
    expect(normalizeAuditLogQueryLimit(5000)).toBe(MAX_AUDIT_LOG_QUERY_LIMIT);
    expect(normalizeAuditLogQueryLimit(0)).toBe(1);
    expect(normalizeAuditLogQueryLimit(Number.NaN)).toBe(DEFAULT_AUDIT_LOG_QUERY_LIMIT);
  });
});
