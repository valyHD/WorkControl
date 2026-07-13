import { httpsCallable } from "firebase/functions";
import { functions } from "../../../lib/firebase/firebase";

export async function adminCreateUserWithEmail(params: {
  fullName: string;
  email: string;
  password: string;
  role: "admin" | "manager" | "angajat";
  roleTitle?: string;
  department?: string;
  themeKey: string;
  companyId?: string;
  globalAdmin?: boolean;
}) {
  const callable = httpsCallable<
    typeof params,
    { userId: string }
  >(functions, "adminCreateUser");
  const response = await callable(params);
  if (!response.data.userId) throw new Error("Utilizatorul nu a fost creat.");
  return response.data.userId;
}
