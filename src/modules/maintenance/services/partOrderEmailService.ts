import { httpsCallable } from "firebase/functions";
import { functions } from "../../../lib/firebase/firebase";

export type MaintenancePartOrderEmailKind = "supplier_quote_request" | "client_offer";

type SendPartOrderEmailInput = {
  orderId: string;
  kind: MaintenancePartOrderEmailKind;
};

type SendPartOrderEmailResult = {
  sent: boolean;
  messageId: string;
  senderEmail: string;
  recipientEmail: string;
};

export async function sendMaintenancePartOrderEmail(
  orderId: string,
  kind: MaintenancePartOrderEmailKind
): Promise<SendPartOrderEmailResult> {
  const callable = httpsCallable<SendPartOrderEmailInput, SendPartOrderEmailResult>(
    functions,
    "sendMaintenancePartOrderEmail"
  );
  const result = await callable({ orderId, kind });
  if (!result.data?.sent || !result.data.messageId) {
    throw new Error("Gmail nu a confirmat trimiterea emailului.");
  }
  return result.data;
}
