import { httpsCallable } from "firebase/functions";
import { functions } from "../../../lib/firebase/firebase";

export type WorkControlServerHealth = {
  status: "ok";
  checkedAt: number;
  region: string;
  nodeVersion: string;
  uptimeSeconds: number;
  services: {
    firestoreAdmin: boolean;
    messagingAdmin: boolean;
  };
};

export async function getWorkControlServerHealth() {
  const callable = httpsCallable<Record<string, never>, WorkControlServerHealth>(
    functions,
    "getWorkControlHealth"
  );
  const response = await callable({});
  return response.data;
}
