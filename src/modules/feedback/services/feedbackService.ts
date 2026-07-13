import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../../../lib/firebase/firebase";
import {
  getCurrentCompanyAccessContext,
  requirePrimaryCompanyId,
} from "../../../lib/firebase/companyAccess";

export type FeedbackCategory = "idea" | "problem" | "usability";

export function validateFeedbackInput(input: {
  ownerUserId: string;
  category: string;
  message: string;
  path: string;
}) {
  const message = input.message.trim();
  if (!input.ownerUserId) throw new Error("Trebuie sa fii autentificat.");
  if (!["idea", "problem", "usability"].includes(input.category)) {
    throw new Error("Categoria de feedback este invalida.");
  }
  if (message.length < 5) throw new Error("Descrie feedbackul in cel putin 5 caractere.");
  if (message.length > 1500) throw new Error("Feedbackul este prea lung.");
  return {
    ownerUserId: input.ownerUserId,
    category: input.category as FeedbackCategory,
    message,
    path: input.path.slice(0, 200),
  };
}

export async function submitAppFeedback(input: {
  ownerUserId: string;
  category: FeedbackCategory;
  message: string;
  path: string;
}) {
  const validated = validateFeedbackInput(input);
  const context = await getCurrentCompanyAccessContext();
  if (context.uid !== validated.ownerUserId) throw new Error("Poti trimite numai feedback propriu.");
  await addDoc(collection(db, "appFeedback"), {
    ...validated,
    companyId: requirePrimaryCompanyId(context),
    status: "new",
    createdAt: Date.now(),
    createdAtServer: serverTimestamp(),
  });
}
