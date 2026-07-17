import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { storage } from "../../../lib/firebase/firebase";
import type { MaintenancePartOrderAttachment } from "../../../types/maintenance";

const MAX_CLIENT_OFFER_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function safeFileName(value: string): string {
  const fallback = "atasament";
  const clean = value
    .trim()
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
  return clean || fallback;
}

export async function uploadPartOrderClientAttachment(
  orderId: string,
  file: File
): Promise<MaintenancePartOrderAttachment> {
  if (!orderId) throw new Error("Comanda de piese nu este valida.");
  if (!ALLOWED_ATTACHMENT_TYPES.has(file.type)) {
    throw new Error("Atasamentul trebuie sa fie PDF, JPG, PNG sau WEBP.");
  }
  if (file.size > MAX_CLIENT_OFFER_ATTACHMENT_BYTES) {
    throw new Error("Atasamentul depaseste limita de 15 MB.");
  }

  const uploadedAt = Date.now();
  const name = safeFileName(file.name);
  const path = `maintenance-part-orders/${orderId}/client-offer-${uploadedAt}-${name}`;
  const fileRef = ref(storage, path);
  await uploadBytes(fileRef, file, {
    contentType: file.type,
    customMetadata: {
      orderId,
      uploadedAt: String(uploadedAt),
      purpose: "client-offer",
    },
  });
  const url = await getDownloadURL(fileRef);

  return {
    name: file.name,
    url,
    path,
    contentType: file.type,
    sizeBytes: file.size,
    uploadedAt,
  };
}
