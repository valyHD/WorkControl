import { httpsCallable } from "firebase/functions";
import { functions } from "../../../lib/firebase/firebase";

export const SHARED_GMAIL_SENDER_EMAIL = "liftultau@gmail.com";

type SharedGmailResult = {
  status: "sent" | "already_sent";
  senderEmail: string;
  messageId: string;
};

function randomRequestId(prefix: string): string {
  const randomId = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${randomId}`;
}

const sendSharedMaintenanceEmail = httpsCallable<
  Record<string, string>,
  SharedGmailResult
>(functions, "sendSharedMaintenanceEmail");

export async function sendSharedMaintenanceReportEmail(input: {
  clientId: string;
  reportId: string;
}): Promise<SharedGmailResult> {
  const result = await sendSharedMaintenanceEmail({
    kind: "maintenance_report",
    clientId: input.clientId,
    reportId: input.reportId,
    requestId: `maintenance-report:${input.clientId}:${input.reportId}`,
  });
  return result.data;
}

export async function sendSharedMaintenancePartOrderEmail(input: {
  orderId: string;
  target: "supplier" | "client";
}): Promise<SharedGmailResult> {
  const kind = input.target === "supplier"
    ? "maintenance_part_supplier"
    : "maintenance_part_client";
  const result = await sendSharedMaintenanceEmail({
    kind,
    orderId: input.orderId,
    requestId: randomRequestId(`${kind}:${input.orderId}`),
  });
  return result.data;
}
