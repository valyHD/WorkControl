import { doc, getDoc } from "firebase/firestore";
import { db } from "../../../lib/firebase/firebase";

type ProfileCompanyFields = {
  companyIds: string[];
  companyNames: string[];
  primaryCompanyId: string;
  primaryCompanyName: string;
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanList(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => cleanText(item)).filter(Boolean))]
    : [];
}

export function getProfileCompanyFields(data: Record<string, unknown>): ProfileCompanyFields {
  const primaryCompanyId = cleanText(data.primaryCompanyId) || cleanText(data.companyId);
  const companyIds = cleanList(data.companyIds);
  if (primaryCompanyId && !companyIds.includes(primaryCompanyId)) companyIds.unshift(primaryCompanyId);

  const companyNames = cleanList(data.companyNames);
  const primaryCompanyName = cleanText(data.primaryCompanyName) || companyNames[0] || "";

  return {
    companyIds,
    companyNames,
    primaryCompanyId,
    primaryCompanyName,
  };
}

export async function getResolvedProfileCompanyFields(
  data: Record<string, unknown>
): Promise<ProfileCompanyFields> {
  const fields = getProfileCompanyFields(data);
  if (fields.primaryCompanyName || !fields.primaryCompanyId) return fields;

  try {
    const companySnap = await getDoc(doc(db, "firmeMentenanta", fields.primaryCompanyId));
    if (!companySnap.exists()) return fields;
    const companyData = companySnap.data() as Record<string, unknown>;
    const companyName =
      cleanText(companyData.companyName) ||
      cleanText(companyData.name) ||
      fields.primaryCompanyId;
    if (!companyName) return fields;

    return {
      ...fields,
      companyNames: fields.companyNames.includes(companyName)
        ? fields.companyNames
        : [...fields.companyNames, companyName],
      primaryCompanyName: companyName,
    };
  } catch {
    return fields;
  }
}
