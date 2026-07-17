import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowUpDown,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileText,
  History,
  LayoutDashboard,
  PackageSearch,
  PlusCircle,
  Search,
  Trash2,
  UsersRound,
} from "lucide-react";
import { useAuth } from "../../../providers/AuthProvider";
import {
  createMaintenanceClient,
  deleteMaintenanceClient,
  saveMaintenanceCompanyBranding,
  saveMaintenanceReportHistory,
  subscribeMaintenanceClients,
  subscribeMaintenanceCompanyBranding,
  subscribeMaintenanceReportsOverview,
  uploadMaintenanceBrandingAsset,
} from "../services/maintenanceService";
import { getAllUsers } from "../../users/services/usersService";
import { sendSharedMaintenanceGmailReport } from "../services/gmailDraftService";
import { setAssistantPageSelectedEntity } from "../../../lib/assistant/core";
import {
  startMaintenanceReportTask,
  subscribeMaintenanceReportTask,
} from "../services/maintenanceReportBackgroundTask";
import { buildMaintenancePdfBlob, resolveBrandingForCompany, type ReportType } from "../services/maintenancePdf";
import { generateReportId, reviewStandardText } from "../utils/reportUtils";
import type {
  MaintenanceClient,
  MaintenanceCompanyBranding,
  MaintenanceReportHistoryItem,
} from "../../../types/maintenance";
import type { AppUserItem, UserRole } from "../../../types/user";
import { downloadFileFromUrl } from "../../../lib/files/downloadFile";
import ActionBar from "../../../components/ActionBar";
import PageQuickActions from "../../../components/PageQuickActions";
import { PageLayout, PermissionState } from "../../../components/experience";
import {
  ASSISTANT_FILL_MAINTENANCE_CLIENT_EVENT,
  ASSISTANT_FILL_MAINTENANCE_REPORT_EVENT,
} from "../../../lib/assistant/runtime/assistantFormFill";
import { registerAssistantFormDraftAdapter } from "../../../lib/assistant/adapters/assistantFormDraftChannel";
import { highlightAssistantElement } from "../../../lib/assistant/runtime/assistantButtonHighlighter";
import { getMaintenanceModule } from "../maintenanceModules";
import "../pages/maintenance.css";

type ClientFormLift = {
  id: string;
  liftNumber: string;
  expiryDate: string;
  revisionType: string;
};

type ClientFormAddress = {
  id: string;
  address: string;
  lifts: ClientFormLift[];
};

const initialClientForm = {
  name: "",
  email: "",
  maintenanceCompany: "",
  contactPerson: "",
  contactPhone: "",
  addresses: [
    {
      id: "address_initial",
      address: "",
      lifts: [{ id: "lift_initial", liftNumber: "", expiryDate: "", revisionType: "R2" }],
    },
  ] as ClientFormAddress[],
};

type AddressLiftGroup = {
  key: string;
  address: string;
  lifts: string[];
};

type MonthlyReviewMissingLift = {
  clientId: string;
  clientName: string;
  address: string;
  lift: string;
  maintenanceCompany: string;
};

type ExpiringLift = MonthlyReviewMissingLift & {
  expiryDate: string;
};

type GeneratedReportShare = {
  clientName: string;
  clientEmail: string;
  senderEmail: string;
  reportType: ReportType;
  dateText: string;
  timeText: string;
  maintenanceCompany: string;
  pdfUrl: string;
};

type AssistantReportRequest = {
  requestId: string;
  clientQuery: string;
  reportType: ReportType;
  observations: string;
  submitMode: "prepare" | "send";
  waitForPhotos: boolean;
  resolvedClientId?: string;
};

type MaintenanceTab = "dashboard" | "report" | "parts" | "clients" | "lifts" | "companies" | "history" | "checks";

const SHARED_MAINTENANCE_GMAIL_SENDER = "liftultau@gmail.com";

const MAINTENANCE_TABS: Array<{
  id: MaintenanceTab;
  title: string;
  description: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: "dashboard", title: "Dashboard", description: "Privire rapida peste clienti, lifturi si atentionari.", icon: LayoutDashboard },
  { id: "report", title: "Genereaza raport", description: "Raport PDF cu poze si trimitere Gmail.", icon: FileText },
  { id: "parts", title: "Piese", description: "Comenzi piese, oferte si status montaj.", icon: PackageSearch },
  { id: "clients", title: "Clienti", description: "Adauga, cauta si gestioneaza clienti/lifturi.", icon: UsersRound },
  { id: "lifts", title: "Lifturi", description: "Inventar, adresă, revizie și expirare.", icon: ArrowUpDown },
  { id: "companies", title: "Firme / Branding", description: "Logo si stampila pe firma de mentenanta.", icon: Building2 },
  { id: "history", title: "Istoric rapoarte", description: "Cauta rapoarte, descarca PDF-uri si vezi poze.", icon: History },
  { id: "checks", title: "Verificari lunare", description: "Revizii lipsa si lifturi expirate.", icon: ClipboardCheck },
];

const VALID_MAINTENANCE_TABS = new Set<MaintenanceTab>(MAINTENANCE_TABS.map((tab) => tab.id));

function getMaintenanceTabFromLocation(pathname: string, params: URLSearchParams): MaintenanceTab {
  const tab = params.get("tab") as MaintenanceTab | null;
  if (tab && VALID_MAINTENANCE_TABS.has(tab)) return tab;
  if (pathname === "/maintenance/manage") return "clients";
  if (pathname === "/maintenance/parts" || pathname === "/maintenance/orders") return "parts";
  return "dashboard";
}
function reportMonthValue(createdAt: number) {
  if (!createdAt) return "";
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthBounds(offsetMonths: number) {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  start.setMonth(start.getMonth() + offsetMonths);

  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);

  return { start, end };
}

function parseMaintenanceDate(value: string): Date | null {
  const text = value.trim();
  if (!text || text === "-") return null;

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const date = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const roMatch = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (roMatch) {
    const date = new Date(Number(roMatch[3]), Number(roMatch[2]) - 1, Number(roMatch[1]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function normalizeMaintenanceAssistantText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const MAINTENANCE_ASSISTANT_WEAK_QUERY_TOKENS = new Set([
  "adresa",
  "bloc",
  "blocul",
  "bl",
  "client",
  "clientul",
  "lift",
  "liftul",
  "sc",
  "scara",
]);

function tokenizeMaintenanceAssistantText(value: string) {
  return normalizeMaintenanceAssistantText(value)
    .split(" ")
    .filter((token) => token && !MAINTENANCE_ASSISTANT_WEAK_QUERY_TOKENS.has(token));
}

function createMaintenanceAssistantSearchProfile(client: MaintenanceClient) {
  const names = [client.name].filter(Boolean).map(normalizeMaintenanceAssistantText);
  const lifts = [
    client.liftNumber,
    ...(client.liftNumbers || []),
    ...(client.addresses || []).flatMap((address) =>
      (address.lifts || []).map((lift) => lift.serialNumber || lift.label || "")
    ),
  ]
    .filter(Boolean)
    .map(normalizeMaintenanceAssistantText);
  const addresses = [
    client.address,
    ...(client.addresses || []).map((address) => address.label || address.street || ""),
  ]
    .filter(Boolean)
    .map(normalizeMaintenanceAssistantText);
  const fullText = normalizeMaintenanceAssistantText(
    [client.name, client.address, ...lifts, ...addresses].filter(Boolean).join(" ")
  );
  const tokens = new Set(tokenizeMaintenanceAssistantText(fullText));

  return { client, names, lifts, addresses, fullText, tokens };
}

function maintenanceAssistantQueryMatches(fullText: string, tokens: Set<string>, needle: string, queryTokens: string[]) {
  return fullText.includes(needle) || queryTokens.every((token) => tokens.has(token) || fullText.includes(token));
}

function findMaintenanceClientMatchesForAssistant(clients: MaintenanceClient[], clientQuery: string) {
  const needle = normalizeMaintenanceAssistantText(clientQuery);
  const queryTokens = tokenizeMaintenanceAssistantText(clientQuery);
  if (!needle || queryTokens.length === 0) return [];

  const searchable = clients.map(createMaintenanceAssistantSearchProfile);
  const matches = searchable.filter((item) => {
    const exact = item.names.includes(needle) || item.lifts.includes(needle) || item.addresses.includes(needle);
    return exact || maintenanceAssistantQueryMatches(item.fullText, item.tokens, needle, queryTokens);
  });

  return matches.sort((left, right) => {
    const score = (item: (typeof matches)[number]) => {
      let total = 0;
      if (item.names.includes(needle) || item.lifts.includes(needle) || item.addresses.includes(needle)) total += 100;
      if (item.fullText.includes(needle)) total += 20;
      total += queryTokens.filter((token) => item.tokens.has(token) || item.fullText.includes(token)).length * 5;
      if (item.names.some((name) => queryTokens.some((token) => name.includes(token)))) total += 3;
      if ([...item.addresses, ...item.lifts].some((text) => queryTokens.some((token) => text.includes(token)))) total += 3;
      return total;
    };
    return score(right) - score(left);
  });
}

function findMaintenanceClientsForAssistant(clients: MaintenanceClient[], clientQuery: string) {
  const matches = findMaintenanceClientMatchesForAssistant(clients, clientQuery);
  return matches.map((item) => item.client);
}

function isExactMaintenanceClientAssistantMatch(
  client: MaintenanceClient,
  clientQuery: string
) {
  const needle = normalizeMaintenanceAssistantText(clientQuery);
  const queryTokens = tokenizeMaintenanceAssistantText(clientQuery);
  if (!needle || queryTokens.length === 0) return false;

  const profile = createMaintenanceAssistantSearchProfile(client);
  const directExact = [...profile.names, ...profile.lifts, ...profile.addresses].includes(needle);
  if (directExact) return true;
  if (queryTokens.length < 2) return false;

  const nameHasToken = profile.names.some((name) => queryTokens.some((token) => name.includes(token)));
  const allTokensInName = profile.names.some((name) => queryTokens.every((token) => name.includes(token)));
  const locationHasToken = [...profile.addresses, ...profile.lifts].some((text) =>
    queryTokens.some((token) => text.includes(token))
  );
  const allTokensFound = queryTokens.every(
    (token) => profile.tokens.has(token) || profile.fullText.includes(token)
  );

  return allTokensFound && (allTokensInName || (nameHasToken && locationHasToken));
}

function resolveAssistantAddressLiftForClient(client: MaintenanceClient, clientQuery: string) {
  const needle = normalizeMaintenanceAssistantText(clientQuery);
  const queryTokens = tokenizeMaintenanceAssistantText(clientQuery);
  if (!needle || queryTokens.length === 0) return { address: "", lift: "" };

  const scoredGroups = buildAddressLiftGroups(client)
    .map((group) => {
      const addressText = normalizeMaintenanceAssistantText(group.address);
      const lifts = group.lifts.map((lift) => ({ value: lift, text: normalizeMaintenanceAssistantText(lift) }));
      const fullText = normalizeMaintenanceAssistantText([group.address, ...group.lifts].join(" "));
      let score = 0;
      if (fullText.includes(needle)) score += 30;
      score += queryTokens.filter((token) => fullText.includes(token)).length * 10;
      if (queryTokens.some((token) => addressText.includes(token))) score += 8;
      if (lifts.some((lift) => queryTokens.some((token) => lift.text.includes(token)))) score += 12;
      const exactLift = lifts.find((lift) => lift.text === needle || queryTokens.some((token) => lift.text === token));
      return {
        group,
        score,
        lift: exactLift?.value || (lifts.length === 1 ? lifts[0]?.value || "" : ""),
      };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);

  const best = scoredGroups[0];
  if (!best || (scoredGroups[1] && scoredGroups[1].score === best.score)) {
    return { address: "", lift: "" };
  }
  return { address: best.group.address === "-" ? "" : best.group.address, lift: best.lift };
}

function getMissingMonthlyReviews(
  clients: MaintenanceClient[],
  reports: MaintenanceReportHistoryItem[]
): MonthlyReviewMissingLift[] {
  const { start, end } = getMonthBounds(0);
  const reportsByClient = reports.reduce<Record<string, MaintenanceReportHistoryItem[]>>((acc, report) => {
    if (!report.clientId) return acc;
    acc[report.clientId] = [...(acc[report.clientId] || []), report];
    return acc;
  }, {});

  return clients.flatMap((client) => {
    const reviewedLifts = new Set(
      (reportsByClient[client.id] || [])
        .filter((report) => {
          const createdAt = Number(report.createdAt || 0);
          return (
            report.reportType === "revizie" &&
            createdAt >= start.getTime() &&
            createdAt < end.getTime()
          );
        })
        .map((report) => report.lift.trim())
        .filter(Boolean)
    );

    return getClientLiftRows(client).filter((row) => !reviewedLifts.has(row.lift));
  });
}

function getExpiredAndNextMonthExpiringLifts(clients: MaintenanceClient[]): ExpiringLift[] {
  const { end } = getMonthBounds(1);

  return clients.flatMap((client) =>
    getClientLiftRows(client)
      .map((row) => ({
        ...row,
        expiryDate: getLiftExpiryDate(client, row.lift),
      }))
      .filter((row) => {
        const expiry = parseMaintenanceDate(row.expiryDate);
        return expiry ? expiry < end : false;
      })
  );
}

function getLiftExpiryDate(client: MaintenanceClient, lift: string): string {
  const liftLabel = lift.trim();
  if (!liftLabel) return "-";

  const addressLift = (client.addresses || [])
    .flatMap((address) => address.lifts || [])
    .find((item) => (item.serialNumber || item.label || "").trim() === liftLabel);

  return addressLift?.inspectionExpiryDate || client.liftExpiryDates?.[liftLabel] || client.expiryDate || "-";
}

function getClientLiftCount(client: MaintenanceClient): number {
  const lifts = [
    ...((client.liftNumbers || []).length ? client.liftNumbers : client.liftNumber ? [client.liftNumber] : []),
    ...(client.addresses || []).flatMap((address) =>
      (address.lifts || []).map((lift) => lift.serialNumber || lift.label || "")
    ),
  ]
    .map((lift) => lift.trim())
    .filter(Boolean);

  return new Set(lifts).size;
}

function getClientLiftRows(client: MaintenanceClient): MonthlyReviewMissingLift[] {
  return buildAddressLiftGroups(client).flatMap((group) =>
    group.lifts
      .map((lift) => lift.trim())
      .filter(Boolean)
      .map((lift) => ({
        clientId: client.id,
        clientName: client.name || "-",
        address: group.address || "-",
        lift,
        maintenanceCompany: client.maintenanceCompany || "-",
      }))
  );
}

function createEmptyClientFormLift(): ClientFormLift {
  return {
    id: `lift_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    liftNumber: "",
    expiryDate: "",
    revisionType: "R2",
  };
}

function createEmptyClientFormAddress(): ClientFormAddress {
  return {
    id: `address_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    address: "",
    lifts: [createEmptyClientFormLift()],
  };
}

function assistantTextField(fields: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = fields[key];
    if (Array.isArray(value)) {
      const joined = value.map((item) => String(item || "").trim()).filter(Boolean).join(", ");
      if (joined) return joined;
      continue;
    }
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function assistantLiftNumbers(fields: Record<string, unknown>) {
  const values = [
    fields.liftNumbers,
    fields.liftNumber,
    fields.lift,
    fields.numarLift,
    fields["numar lift"],
  ];
  return Array.from(
    new Set(
      values
        .flatMap((value) => (Array.isArray(value) ? value : [value]))
        .flatMap((value) => String(value ?? "").split(/[,;/]|\s+si\s+|\s+și\s+/i))
        .map((value) => value.trim().replace(/\s+/g, ""))
        .filter(Boolean)
    )
  );
}

function sanitizeAssistantClientName(value: unknown) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const normalized = normalizeMaintenanceAssistantText(text);
  if (
    /\b(pagina|formular|formularul|mentenanta|maintenance|revizie|revizii|lift|liftul|lifturi|email|mail|firma|companie|adresa|telefon|contact)\b/.test(
      normalized
    )
  ) {
    return "";
  }
  if (normalized.split(/\s+/).length > 8) return "";
  return text;
}

function assistantClientName(fields: Record<string, unknown>) {
  return sanitizeAssistantClientName(assistantTextField(fields, ["name", "nume", "client"]));
}

function buildAssistantClientAddress(fields: Record<string, unknown>) {
  const directAddress = assistantTextField(fields, ["address", "adresa"]);
  const street = assistantTextField(fields, ["street", "strada"]);
  const city = assistantTextField(fields, ["city", "oras", "localitate"]);
  return [directAddress, street, city].filter(Boolean).join(", ");
}

function buildAddressLiftGroups(client: MaintenanceClient): AddressLiftGroup[] {
  const mainAddress = client.address.trim();
  const allClientLifts = Array.from(
    new Set(((client.liftNumbers || []).length ? client.liftNumbers : client.liftNumber ? [client.liftNumber] : []).filter(Boolean))
  );
  const secondaryGroups = (client.addresses || []).map((address) => {
    const label = (address.label || address.street || "").trim();
    const lifts = Array.from(
      new Set((address.lifts || []).map((lift) => lift.serialNumber || lift.label || "").map((item) => item.trim()).filter(Boolean))
    );
    return {
      key: address.id,
      address: label,
      lifts,
    };
  });

  const secondaryLiftSet = new Set(secondaryGroups.flatMap((group) => group.lifts));
  const mainLifts = allClientLifts.filter((lift) => !secondaryLiftSet.has(lift));
  const groups: AddressLiftGroup[] = [];

  if (mainAddress || mainLifts.length) {
    groups.push({
      key: `${client.id}_main`,
      address: mainAddress || "Adresă principală",
      lifts: mainLifts,
    });
  }

  secondaryGroups.forEach((group) => {
    if (group.address || group.lifts.length) {
      groups.push({
        key: group.key,
        address: group.address || "Adresă secundară",
        lifts: group.lifts,
      });
    }
  });

  if (groups.length === 0) {
    groups.push({
      key: `${client.id}_empty`,
      address: "-",
      lifts: [],
    });
  }

  return groups;
}

export default function MaintenanceWorkspace() {
  const { role, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const assistantParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const [activeMaintenanceTab, setActiveMaintenanceTab] = useState<MaintenanceTab>(() =>
    getMaintenanceTabFromLocation(location.pathname, new URLSearchParams(location.search))
  );
  const assistantMode = assistantParams.get("assistant") || "";
  const assistantClientFormOpen = activeMaintenanceTab === "clients" && assistantMode === "client";
  const [clients, setClients] = useState<MaintenanceClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [searchText, setSearchText] = useState("");
  const [clientForm, setClientForm] = useState(initialClientForm);
  const [brandingItems, setBrandingItems] = useState<MaintenanceCompanyBranding[]>([]);
  const [brandingCompanyName, setBrandingCompanyName] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [stampFile, setStampFile] = useState<File | null>(null);
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [brandingMessage, setBrandingMessage] = useState("");
  const [brandingError, setBrandingError] = useState("");
  const [reportSearch, setReportSearch] = useState("");
  const [reportSuggestionsOpen, setReportSuggestionsOpen] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [reportAddress, setReportAddress] = useState("");
  const [reportLift, setReportLift] = useState("");
  const [reportTypeDraft, setReportTypeDraft] = useState<ReportType>("revizie");
  const [reportComments, setReportComments] = useState("");
  const [reportImageFiles, setReportImageFiles] = useState<File[]>([]);
  const [technicians, setTechnicians] = useState<AppUserItem[]>([]);
  const [selectedTechnicianId, setSelectedTechnicianId] = useState(() => user?.uid || "");
  const [reportGenerating, setReportGenerating] = useState(false);
  const [reportMessage, setReportMessage] = useState("");
  const [reportError, setReportError] = useState("");
  const [monthlyReviewChecking, setMonthlyReviewChecking] = useState(false);
  const [monthlyReviewMissing, setMonthlyReviewMissing] = useState<MonthlyReviewMissingLift[] | null>(null);
  const [monthlyReviewError, setMonthlyReviewError] = useState("");
  const [reportHistoryByClient, setReportHistoryByClient] = useState<Record<string, MaintenanceReportHistoryItem[]>>({});
  const [reportHistorySearch, setReportHistorySearch] = useState("");
  const [reportHistoryMonth, setReportHistoryMonth] = useState("");
  const [reportHistoryType, setReportHistoryType] = useState("");
  const [reportHistoryTechnician, setReportHistoryTechnician] = useState("");
  const [checkCompanyFilter, setCheckCompanyFilter] = useState("");
  const [checkClientFilter, setCheckClientFilter] = useState("");
  const [checkAddressFilter, setCheckAddressFilter] = useState("");
  const [clientFormVisible, setClientFormVisible] = useState(false);
  const [liveStatsError, setLiveStatsError] = useState("");
  const [lastGeneratedReport, setLastGeneratedReport] = useState<GeneratedReportShare | null>(null);
  const [assistantReportRequest, setAssistantReportRequest] = useState<AssistantReportRequest | null>(null);
  const assistantReportKeyRef = useRef("");
  const assistantClientFormKeyRef = useRef("");
  const assistantReportExecutionRef = useRef("");
  const generateReportRef = useRef<(type: ReportType) => Promise<void>>(async () => undefined);
  const technicianDefaultInitializedRef = useRef(false);
  const gmailSenderEmail = SHARED_MAINTENANCE_GMAIL_SENDER;
  const shouldLoadClients = ["dashboard", "report", "clients", "lifts", "checks"].includes(activeMaintenanceTab);
  const shouldLoadBranding = activeMaintenanceTab === "report" || activeMaintenanceTab === "companies";
  const shouldLoadReportOverview = ["dashboard", "history", "checks"].includes(activeMaintenanceTab);
  const shouldLoadTechnicians = activeMaintenanceTab === "report";
  const currentTechnicianId = user?.uid || "";
  const currentTechnicianName = (user?.displayName || user?.email || "Utilizator").trim();
  const currentTechnicianEmail = user?.email || "";
  const currentTechnicianRole: UserRole = role === "admin" || role === "manager" ? role : "angajat";

  useEffect(() => {
    if (!shouldLoadTechnicians || !currentTechnicianId || technicianDefaultInitializedRef.current) {
      return;
    }

    setSelectedTechnicianId(currentTechnicianId);
    technicianDefaultInitializedRef.current = true;
  }, [currentTechnicianId, currentTechnicianName, shouldLoadTechnicians]);

  useEffect(() => {
    if (!shouldLoadClients) {
      return undefined;
    }
    setLoading(true);
    const unsubscribe = subscribeMaintenanceClients(
      (data) => {
        setClients(data);
        setLoading(false);
      },
      (err) => {
        console.error(err);
        setError("Nu am putut încărca baza de mentenanță.");
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [shouldLoadClients]);

  useEffect(() => {
    if (!shouldLoadBranding) {
      return undefined;
    }
    const unsubscribe = subscribeMaintenanceCompanyBranding(
      (items) => {
        setBrandingItems(items);
      },
      (err) => {
        console.error(err);
        setBrandingError("Nu am putut încărca branding-ul companiilor.");
      }
    );

    return unsubscribe;
  }, [shouldLoadBranding]);

  useEffect(() => {
    setReportHistoryByClient({});
    if (!shouldLoadReportOverview) {
      return undefined;
    }

    return subscribeMaintenanceReportsOverview(
      (items) => {
        const grouped = items.reduce<Record<string, MaintenanceReportHistoryItem[]>>(
          (result, item) => {
            if (!item.clientId) return result;
            (result[item.clientId] ||= []).push(item);
            return result;
          },
          {}
        );
        setReportHistoryByClient(grouped);
        setLiveStatsError("");
      },
      (err) => {
        console.error(err);
        setLiveStatsError("Nu am putut incarca live istoricul rapoartelor.");
      }
    );
  }, [shouldLoadReportOverview]);

  useEffect(() => {
    if (!shouldLoadTechnicians) return undefined;
    let active = true;
    const currentTechnician: AppUserItem | null = currentTechnicianId
      ? {
          id: currentTechnicianId,
          uid: currentTechnicianId,
          fullName: currentTechnicianName,
          email: currentTechnicianEmail,
          active: true,
          role: currentTechnicianRole,
        }
      : null;

    getAllUsers()
      .then((items) => {
        if (!active) return;
        const availableTechnicians = items.filter((item) => item.active && item.fullName.trim());
        if (
          currentTechnician &&
          !availableTechnicians.some(
            (item) => item.id === currentTechnician.id || item.uid === currentTechnician.uid
          )
        ) {
          availableTechnicians.unshift(currentTechnician);
        }
        setTechnicians(availableTechnicians);
      })
      .catch((err) => {
        console.error(err);
        setReportError("Nu am putut incarca lista de tehnicieni.");
      });

    return () => {
      active = false;
    };
  }, [
    currentTechnicianEmail,
    currentTechnicianId,
    currentTechnicianName,
    currentTechnicianRole,
    shouldLoadTechnicians,
  ]);

  useEffect(() => {
    if (!shouldLoadTechnicians) {
      technicianDefaultInitializedRef.current = false;
    }
  }, [shouldLoadTechnicians]);

  useEffect(() => {
    setActiveMaintenanceTab(getMaintenanceTabFromLocation(location.pathname, new URLSearchParams(location.search)));
  }, [location.pathname, location.search]);

  function openMaintenanceTab(tab: MaintenanceTab, extraParams?: Record<string, string>) {
    const params = new URLSearchParams();
    params.set("tab", tab);
    Object.entries(extraParams || {}).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    setActiveMaintenanceTab(tab);
    navigate(`/maintenance?${params.toString()}`);
    if (tab === "report") {
      window.setTimeout(() => {
        document.getElementById("maintenance-report-form-start")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      }, 120);
    }
  }

  useEffect(() => {
    if (assistantClientFormOpen) {
      setClientFormVisible(true);
    }
  }, [assistantClientFormOpen]);

  useEffect(() => {
    if (!assistantClientFormOpen) return;
    const key = location.search;
    if (assistantClientFormKeyRef.current === key) return;
    assistantClientFormKeyRef.current = key;

    const name = assistantParams.get("name") || "";
    const email = assistantParams.get("email") || "";
    const company = assistantParams.get("company") || "";
    const addressValue = assistantParams.get("address") || "";
    const liftValue = assistantParams.get("lift") || "";

    if (name || email || company || addressValue || liftValue) {
      setClientForm((prev) => ({
        ...prev,
        name: name || prev.name,
        email: email || prev.email,
        maintenanceCompany: company || prev.maintenanceCompany,
        addresses: prev.addresses.map((address, addressIndex) =>
          addressIndex === 0
            ? {
                ...address,
                address: addressValue || address.address,
                lifts: address.lifts.map((lift, liftIndex) =>
                  liftIndex === 0 ? { ...lift, liftNumber: liftValue || lift.liftNumber } : lift
                ),
              }
            : address
        ),
      }));
    }

    window.setTimeout(() => {
      document.getElementById("maintenance-client-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
  }, [assistantClientFormOpen, assistantParams, location.search]);

  useEffect(() => {
    const handleAssistantClientFill = (detail: Readonly<Record<string, unknown>>) => {
      const liftNumbers = assistantLiftNumbers(detail);
      const clientName = assistantClientName(detail);
      const expiryDate = assistantTextField(detail, ["expiryDate", "inspectionExpiryDate", "expira"]);
      const revisionType = assistantTextField(detail, ["revisionType", "tipRevizie", "revizie"]).toUpperCase();
      const address = buildAssistantClientAddress(detail);

      setActiveMaintenanceTab("clients");
      setClientFormVisible(true);
      setError("");
      setMessage("Asistentul a completat formularul. Verifica datele si salveaza clientul.");

      setClientForm((prev) => ({
        ...prev,
        name: clientName || prev.name,
        email: assistantTextField(detail, ["email", "mail"]) || prev.email,
        maintenanceCompany:
          assistantTextField(detail, ["maintenanceCompany", "firmaMentenanta", "firma", "company"]) ||
          prev.maintenanceCompany,
        contactPerson: assistantTextField(detail, ["contactPerson", "persoanaContact", "contact"]) || prev.contactPerson,
        contactPhone: assistantTextField(detail, ["contactPhone", "telefon", "phone"]) || prev.contactPhone,
        addresses: [
          {
            id: prev.addresses[0]?.id || "address_initial",
            address: address || prev.addresses[0]?.address || "",
            lifts: (liftNumbers.length ? liftNumbers : [prev.addresses[0]?.lifts[0]?.liftNumber || ""]).map(
              (liftNumber, index) => ({
                id: prev.addresses[0]?.lifts[index]?.id || `lift_assistant_${Date.now()}_${index}`,
                liftNumber,
                expiryDate: expiryDate || prev.addresses[0]?.lifts[index]?.expiryDate || "",
                revisionType: revisionType === "R1" || revisionType === "R2" ? revisionType : prev.addresses[0]?.lifts[index]?.revisionType || "R2",
              })
            ),
          },
          ...prev.addresses.slice(1),
        ],
      }));

      if (location.pathname !== "/maintenance" || assistantParams.get("tab") !== "clients") {
        navigate("/maintenance?tab=clients&assistant=client", { replace: true });
      }

      window.setTimeout(() => {
        document.getElementById("maintenance-client-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
        highlightAssistantElement("[data-assistant-action='maintenance-save-client']");
      }, 220);
    };

    return registerAssistantFormDraftAdapter(
      ASSISTANT_FILL_MAINTENANCE_CLIENT_EVENT,
      handleAssistantClientFill
    );
  }, [assistantParams, location.pathname, navigate]);

  useEffect(() => {
    const handleAssistantReportFill = (detail: Readonly<Record<string, unknown>>) => {
      const clientQuery = assistantTextField(detail, ["clientQuery", "client", "name"]);
      const reportType: ReportType =
        assistantTextField(detail, ["reportType", "tipRaport"]).toLowerCase() === "interventie"
          ? "interventie"
          : "revizie";
      const observations = assistantTextField(detail, [
        "observations",
        "observation",
        "comments",
        "observatii",
      ]);
      const submitMode = detail.submitMode === "send" ? "send" : "prepare";
      const waitForPhotos = detail.waitForPhotos === true;
      const requestId = `assistant-report-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      setActiveMaintenanceTab("report");
      setReportTypeDraft(reportType);
      setReportComments(observations);
      setReportImageFiles([]);
      setSelectedClientId("");
      setReportSearch(clientQuery);
      setReportAddress("");
      setReportLift("");
      setReportSuggestionsOpen(false);
      setReportError("");
      setReportMessage(
        submitMode === "send"
          ? "Comanda a fost confirmata. Verific clientul si datele raportului inainte de trimitere."
          : waitForPhotos
            ? "Completez raportul. Ataseaza pozele, apoi apasa Genereaza tipul selectat."
            : "Completez raportul si il las pregatit pentru verificare."
      );
      setAssistantReportRequest({
        requestId,
        clientQuery,
        reportType,
        observations,
        submitMode,
        waitForPhotos,
      });

      if (location.pathname !== "/maintenance" || assistantParams.get("tab") !== "report") {
        navigate("/maintenance?tab=report&assistant=report", { replace: true });
      }

      window.setTimeout(() => {
        document
          .getElementById("maintenance-report-form-start")
          ?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      }, 160);
    };

    return registerAssistantFormDraftAdapter(
      ASSISTANT_FILL_MAINTENANCE_REPORT_EVENT,
      handleAssistantReportFill
    );
  }, [assistantParams, location.pathname, navigate]);

  const filteredClients = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) {
      return clients;
    }

    return clients.filter((client) => {
      const addresses = [
        client.address,
        ...(client.addresses || []).map((address) => address.label || address.street || ""),
      ].filter(Boolean);
      const lifts = [
        ...((client.liftNumbers || []).length ? client.liftNumbers : client.liftNumber ? [client.liftNumber] : []),
        ...(client.addresses || []).flatMap((address) =>
          (address.lifts || []).map((lift) => lift.serialNumber || lift.label || "")
        ),
      ].filter(Boolean);
      const fullText = `${client.name} ${addresses.join(" ")} ${lifts.join(" ")}`.toLowerCase();
      return fullText.includes(query);
    });
  }, [clients, searchText]);

  const allReportHistory = useMemo(
    () => Object.values(reportHistoryByClient).flat(),
    [reportHistoryByClient]
  );

  const liveMonthlyMissingReviews = useMemo(
    () => getMissingMonthlyReviews(clients, allReportHistory),
    [clients, allReportHistory]
  );

  const liveTotalLifts = useMemo(
    () => clients.reduce((total, client) => total + getClientLiftRows(client).length, 0),
    [clients]
  );

  const allLiftRows = useMemo(() => clients.flatMap((client) => getClientLiftRows(client)), [clients]);

  const liveExpiredAndNextMonthExpiringLifts = useMemo(
    () => getExpiredAndNextMonthExpiringLifts(clients),
    [clients]
  );

  const clientsWithoutEmail = useMemo(
    () => clients.filter((client) => !getClientEmail(client)),
    [clients]
  );

  const sortedReportHistory = useMemo(
    () => [...allReportHistory].sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0)),
    [allReportHistory]
  );

  const recentReports = useMemo(() => sortedReportHistory.slice(0, 5), [sortedReportHistory]);

  const maintenanceCompanyOptions = useMemo(
    () =>
      Array.from(new Set(clients.map((client) => client.maintenanceCompany.trim()).filter(Boolean))).sort((left, right) =>
        left.localeCompare(right, "ro")
      ),
    [clients]
  );

  const checkClientOptions = useMemo(
    () => Array.from(new Set(clients.map((client) => client.name.trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right, "ro")),
    [clients]
  );

  const checkAddressOptions = useMemo(
    () =>
      Array.from(
        new Set(
          clients
            .flatMap((client) => [client.address, ...(client.addresses || []).map((address) => address.label || address.street || "")])
            .map((value) => value.trim())
            .filter(Boolean)
        )
      ).sort((left, right) => left.localeCompare(right, "ro")),
    [clients]
  );

  const filteredReportHistory = useMemo(() => {
    const query = reportHistorySearch.trim().toLowerCase();
    return sortedReportHistory.filter((report) => {
      const haystack = [
        report.clientName,
        report.reportType,
        report.address,
        report.lift,
        report.technicianName,
        report.comments,
        report.dateText,
        report.timeText,
        report.fileName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (query && !haystack.includes(query)) return false;
      if (reportHistoryMonth && reportMonthValue(Number(report.createdAt || 0)) !== reportHistoryMonth) return false;
      if (reportHistoryType && report.reportType !== reportHistoryType) return false;
      if (reportHistoryTechnician && report.technicianName !== reportHistoryTechnician) return false;
      return true;
    });
  }, [reportHistoryMonth, reportHistorySearch, reportHistoryTechnician, reportHistoryType, sortedReportHistory]);

  const reportTechnicianOptions = useMemo(
    () => Array.from(new Set(sortedReportHistory.map((report) => report.technicianName).filter(Boolean))).sort((left, right) => left.localeCompare(right, "ro")),
    [sortedReportHistory]
  );

  function checkFilterMatches(item: MonthlyReviewMissingLift) {
    if (checkCompanyFilter && item.maintenanceCompany !== checkCompanyFilter) return false;
    if (checkClientFilter && item.clientName !== checkClientFilter) return false;
    if (checkAddressFilter && item.address !== checkAddressFilter) return false;
    return true;
  }

  const filteredMonthlyMissingReviews = useMemo(
    () => liveMonthlyMissingReviews.filter(checkFilterMatches),
    [checkAddressFilter, checkClientFilter, checkCompanyFilter, liveMonthlyMissingReviews]
  );

  const filteredExpiredLifts = useMemo(
    () => liveExpiredAndNextMonthExpiringLifts.filter(checkFilterMatches),
    [checkAddressFilter, checkClientFilter, checkCompanyFilter, liveExpiredAndNextMonthExpiringLifts]
  );

  function getTabBadge(tab: MaintenanceTab) {
    if (tab === "clients") return String(clients.length);
    if (tab === "lifts") return String(liveTotalLifts);
    if (tab === "history") return String(allReportHistory.length);
    if (tab === "checks") return String(liveMonthlyMissingReviews.length + liveExpiredAndNextMonthExpiringLifts.length);
    if (tab === "companies") return String(brandingItems.length);
    return "";
  }

  async function handleCreateClient() {
    setError("");
    setMessage("");
    const addressRows = clientForm.addresses
      .map((address) => ({
        label: address.address.trim(),
        lifts: address.lifts
          .map((lift) => ({
            serialNumber: lift.liftNumber.trim(),
            expiryDate: lift.expiryDate.trim(),
            revisionType: lift.revisionType,
          }))
          .filter((lift) => lift.serialNumber),
      }))
      .filter((address) => address.label || address.lifts.length);
    const firstAddress = addressRows.find((address) => address.label);
    const firstLift = addressRows.flatMap((address) => address.lifts)[0];

    if (!clientForm.name.trim()) {
      setError("Numele clientului este obligatoriu.");
      return;
    }

    if (!firstAddress) {
      setError("Adresa este obligatorie.");
      return;
    }

    if (!firstLift) {
      setError("Numărul liftului este obligatoriu.");
      return;
    }

    try {
      setSubmitting(true);
      await createMaintenanceClient({
        name: clientForm.name,
        email: clientForm.email,
        maintenanceCompany: clientForm.maintenanceCompany,
        contactPerson: clientForm.contactPerson,
        contactPhone: clientForm.contactPhone,
        address: firstAddress.label,
        liftNumber: firstLift.serialNumber,
        expiryDate: firstLift.expiryDate,
        addresses: addressRows,
      });
      setClientForm(initialClientForm);
      setMessage("Clientul din mentenanță a fost salvat.");
    } catch (err) {
      console.error(err);
      setError("Nu am putut salva clientul.");
    } finally {
      setSubmitting(false);
    }
  }

  function updateClientFormAddress(addressId: string, value: string) {
    setClientForm((prev) => ({
      ...prev,
      addresses: prev.addresses.map((address) =>
        address.id === addressId ? { ...address, address: value } : address
      ),
    }));
  }

  function addClientFormAddress() {
    setClientForm((prev) => ({
      ...prev,
      addresses: [...prev.addresses, createEmptyClientFormAddress()],
    }));
  }

  function removeClientFormAddress(addressId: string) {
    setClientForm((prev) => ({
      ...prev,
      addresses: prev.addresses.length > 1
         ? prev.addresses.filter((address) => address.id !== addressId)
        : prev.addresses,
    }));
  }

  function updateClientFormLift(
    addressId: string,
    liftId: string,
    field: "liftNumber" | "expiryDate" | "revisionType",
    value: string
  ) {
    setClientForm((prev) => ({
      ...prev,
      addresses: prev.addresses.map((address) =>
        address.id === addressId
          ? {
              ...address,
              lifts: address.lifts.map((lift) =>
                lift.id === liftId ? { ...lift, [field]: value } : lift
              ),
            }
          : address
      ),
    }));
  }

  function addClientFormLift(addressId: string) {
    setClientForm((prev) => ({
      ...prev,
      addresses: prev.addresses.map((address) =>
        address.id === addressId
           ? { ...address, lifts: [...address.lifts, createEmptyClientFormLift()] }
          : address
      ),
    }));
  }

  function removeClientFormLift(addressId: string, liftId: string) {
    setClientForm((prev) => ({
      ...prev,
      addresses: prev.addresses.map((address) =>
        address.id === addressId && address.lifts.length > 1
           ? { ...address, lifts: address.lifts.filter((lift) => lift.id !== liftId) }
          : address
      ),
    }));
  }

  async function handleSaveBranding() {
    const companyName = brandingCompanyName.trim();
    if (!companyName) {
      setBrandingError("Numele firmei este obligatoriu pentru branding.");
      return;
    }

    if (!logoFile && !stampFile) {
      setBrandingError("Încarcă cel puțin un fișier: logo sau ștampilă.");
      return;
    }

    try {
      setBrandingSaving(true);
      setBrandingError("");
      setBrandingMessage("");

      const payload: {
        companyName: string;
        logoUrl?: string;
        stampUrl?: string;
        logoPath?: string;
        stampPath?: string;
      } = { companyName };

      if (logoFile) {
        const uploadedLogo = await uploadMaintenanceBrandingAsset({
          companyName,
          assetType: "logo",
          file: logoFile,
        });
        payload.logoUrl = uploadedLogo.url;
        payload.logoPath = uploadedLogo.path;
      }

      if (stampFile) {
        const uploadedStamp = await uploadMaintenanceBrandingAsset({
          companyName,
          assetType: "stamp",
          file: stampFile,
        });
        payload.stampUrl = uploadedStamp.url;
        payload.stampPath = uploadedStamp.path;
      }

      await saveMaintenanceCompanyBranding(payload);

      setBrandingMessage(
        `Branding salvat pentru ${companyName}. Raportul PDF va folosi automat logo-ul și ștampila acestei firme.`
      );
      setLogoFile(null);
      setStampFile(null);
    } catch (err) {
      console.error(err);
      setBrandingError("Nu am putut salva branding-ul companiei.");
    } finally {
      setBrandingSaving(false);
    }
  }

  function handleLoadBrandingCompany(companyName: string) {
    setBrandingCompanyName(companyName);
    setBrandingError("");
    setBrandingMessage(
      `Ai selectat ${companyName}. Poți încărca logo sau ștampilă noi pentru a le actualiza.`
    );
  }


  const reportSuggestions = useMemo(() => {
    const query = reportSearch.trim().toLowerCase();
    if (query.length < 2) {
      return [] as MaintenanceClient[];
    }

    return clients
      .filter((client) => {
        const addresses = [
          client.address,
          ...(client.addresses || []).map((address) => address.label || address.street || ""),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        const lifts = [
          ...((client.liftNumbers || []).length
            ? client.liftNumbers
            : client.liftNumber
              ? [client.liftNumber]
              : []),
          ...(client.addresses || []).flatMap((address) =>
            (address.lifts || []).map((lift) => lift.serialNumber || lift.label || "")
          ),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return `${client.name} ${addresses} ${lifts}`.toLowerCase().includes(query);
      })
      .slice(0, 8);
  }, [clients, reportSearch]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("assistant") !== "report") return;

    const key = location.search;
    if (assistantReportKeyRef.current === key) return;

    const clientQuery = (params.get("client") || "").trim();
    if (clientQuery && clients.length === 0) return;

    assistantReportKeyRef.current = key;
    setReportError("");

    if (clientQuery) {
      const needle = normalizeMaintenanceAssistantText(clientQuery);
      const match = clients.find((client) => {
        const clientText = normalizeMaintenanceAssistantText(
          [
            client.name,
            client.address,
            client.liftNumber,
            ...(client.liftNumbers || []),
            ...(client.addresses || []).flatMap((address) => [
              address.label,
              address.street,
              ...(address.lifts || []).map((lift) => `${lift.serialNumber || ""} ${lift.label || ""}`),
            ]),
          ]
            .filter(Boolean)
            .join(" ")
        );
        return clientText.includes(needle);
      });

      if (match) {
        const resolvedLocation = resolveAssistantAddressLiftForClient(match, clientQuery);
        setSelectedClientId(match.id);
        setReportSearch(match.name || match.address || match.liftNumber || clientQuery);
        setReportAddress(resolvedLocation.address);
        setReportLift(resolvedLocation.lift);
        setReportComments("");
        setReportImageFiles([]);
        setReportMessage("Asistentul a selectat clientul. Verifica adresa/liftul, apoi genereaza raportul.");
      } else {
        setSelectedClientId("");
        setReportSearch(clientQuery);
        setReportMessage("Asistentul a completat cautarea. Selecteaza clientul potrivit din sugestii.");
      }
    } else {
      setReportMessage("Asistentul a deschis generatorul. Completeaza clientul si verifica datele inainte de trimitere.");
    }

    window.setTimeout(() => {
      document.getElementById("maintenance-report-form-start")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    }, 180);
  }, [clients, location.search]);

  const selectedClient = useMemo(
    () => clients.find((item) => item.id === selectedClientId) || null,
    [clients, selectedClientId]
  );

  useEffect(() => {
    setAssistantPageSelectedEntity(
      selectedClient
        ? { type: "maintenanceClient", id: selectedClient.id, label: selectedClient.name || selectedClient.id }
        : null
    );
    return () => setAssistantPageSelectedEntity(null);
  }, [selectedClient]);

  const technicianOptions = useMemo(() => {
    if (!currentTechnicianId || technicians.some((item) => item.id === currentTechnicianId || item.uid === currentTechnicianId)) {
      return technicians;
    }
    return [{
      id: currentTechnicianId,
      uid: currentTechnicianId,
      fullName: currentTechnicianName,
      email: currentTechnicianEmail,
      active: true,
      role: currentTechnicianRole,
    } satisfies AppUserItem, ...technicians];
  }, [currentTechnicianEmail, currentTechnicianId, currentTechnicianName, currentTechnicianRole, technicians]);

  const selectedTechnician = useMemo(
    () => technicianOptions.find((item) => item.id === selectedTechnicianId || item.uid === selectedTechnicianId) || null,
    [selectedTechnicianId, technicianOptions]
  );

  const selectedClientAddressGroups = useMemo(
    () => (selectedClient ? buildAddressLiftGroups(selectedClient) : []),
    [selectedClient]
  );

  const reportAddressOptions = useMemo(
    () => Array.from(new Set(selectedClientAddressGroups.map((group) => group.address).filter(Boolean))),
    [selectedClientAddressGroups]
  );

  const reportLiftOptions = useMemo(() => {
    const matchingGroups = selectedClientAddressGroups.filter((group) => !reportAddress || group.address === reportAddress);
    const lifts = matchingGroups.length
       ? matchingGroups.flatMap((group) => group.lifts)
      : selectedClientAddressGroups.flatMap((group) => group.lifts);
    return Array.from(new Set(lifts.filter(Boolean)));
  }, [selectedClientAddressGroups, reportAddress]);

  const selectedLiftRevisionType = useMemo(() => {
    if (!selectedClient || !reportLift) return "R2";
    const addressLiftType = (selectedClient.addresses || [])
      .flatMap((address) => address.lifts || [])
      .find((lift) => (lift.serialNumber || lift.label || "").trim() === reportLift)?.revisionType;
    return selectedClient.liftRevisionTypes?.[reportLift] || addressLiftType || "R2";
  }, [reportLift, selectedClient]);

  useEffect(() => {
    if (!selectedClient) {
      return;
    }

    if (reportAddressOptions.length === 1 && reportAddress !== reportAddressOptions[0]) {
      setReportAddress(reportAddressOptions[0]);
      return;
    }

    if (reportAddress && !reportAddressOptions.includes(reportAddress)) {
      setReportAddress("");
      setReportLift("");
    }
  }, [selectedClient, reportAddress, reportAddressOptions]);

  useEffect(() => {
    if (!selectedClient) {
      return;
    }

    if (reportLiftOptions.length === 1 && reportLift !== reportLiftOptions[0]) {
      setReportLift(reportLiftOptions[0]);
      return;
    }

    if (reportLift && !reportLiftOptions.includes(reportLift)) {
      setReportLift("");
    }
  }, [selectedClient, reportLift, reportLiftOptions]);

  useEffect(() => {
    if (!assistantReportRequest || assistantReportRequest.resolvedClientId || loading) return;

    const matches = findMaintenanceClientsForAssistant(clients, assistantReportRequest.clientQuery);
    const safeMatches =
      assistantReportRequest.submitMode === "send"
        ? matches.filter((client) =>
            isExactMaintenanceClientAssistantMatch(client, assistantReportRequest.clientQuery)
          )
        : matches;
    if (safeMatches.length !== 1) {
      setSelectedClientId("");
      setReportSearch(assistantReportRequest.clientQuery);
      setReportSuggestionsOpen(matches.length > 0);
      setReportMessage(
        safeMatches.length > 1 || matches.length > 1
          ? "Am gasit mai multi clienti. Selecteaza clientul corect; raportul nu a fost trimis."
          : matches.length === 1 && assistantReportRequest.submitMode === "send"
            ? "Clientul nu a putut fi confirmat exact. Selecteaza-l din lista; raportul nu a fost trimis."
            : "Nu am gasit clientul. Verifica numele; raportul nu a fost trimis."
      );
      setAssistantReportRequest(null);
      return;
    }

    const client = safeMatches[0];
    const resolvedLocation = resolveAssistantAddressLiftForClient(
      client,
      assistantReportRequest.clientQuery
    );
    setSelectedClientId(client.id);
    setReportSearch(client.name || client.address || client.liftNumber || "");
    setReportSuggestionsOpen(false);
    setReportAddress(resolvedLocation.address);
    setReportLift(resolvedLocation.lift);
    setReportTypeDraft(assistantReportRequest.reportType);
    setReportComments(assistantReportRequest.observations);
    setAssistantReportRequest((current) =>
      current?.requestId === assistantReportRequest.requestId
        ? { ...current, resolvedClientId: client.id }
        : current
    );

    if (assistantReportRequest.submitMode === "prepare") {
      setAssistantReportRequest(null);
      setReportMessage(
        assistantReportRequest.waitForPhotos
          ? "Raportul este completat. Ataseaza pozele, verifica datele si apasa Genereaza tipul selectat."
          : "Raportul este completat. Verifica adresa, liftul si observatiile inainte de trimitere."
      );
      window.setTimeout(() => {
        highlightAssistantElement(
          assistantReportRequest.waitForPhotos
            ? "[data-assistant-field='maintenance-report-photos']"
            : "[data-assistant-action='maintenance-generate-selected-report']"
        );
      }, 260);
    }
  }, [assistantReportRequest, clients, loading]);

  function selectReportClient(client: MaintenanceClient) {
    setSelectedClientId(client.id);
    setReportSearch(client.name || client.address || client.liftNumber || "");
    setReportSuggestionsOpen(false);
    setReportAddress("");
    setReportLift("");
    setReportComments("");
    setReportImageFiles([]);
    setReportError("");
  }

  function handleReportSearchChange(event: ChangeEvent<HTMLInputElement>) {
    const nextValue = event.target.value;
    if (selectedClient && nextValue !== reportSearch) {
      setSelectedClientId("");
      setReportAddress("");
      setReportLift("");
    }
    setReportSearch(nextValue);
    setReportSuggestionsOpen(nextValue.trim().length >= 2);
    setReportMessage("");
    setReportError("");
  }

  async function handleDeleteClient(client: MaintenanceClient) {
    const confirmed = window.confirm(`Stergi clientul ${client.name || client.id}?`);
    if (!confirmed) {
      return;
    }

    try {
      setError("");
      setMessage("");
      await deleteMaintenanceClient(client.id);
      setMessage("Clientul a fost sters.");
      if (selectedClientId === client.id) {
        setSelectedClientId("");
        setReportSearch("");
        setReportAddress("");
        setReportLift("");
      }
    } catch (err) {
      console.error(err);
      setError("Nu am putut sterge clientul.");
    }
  }

  async function handleCheckMonthlyReviews() {
    try {
      setMonthlyReviewChecking(true);
      setMonthlyReviewError("");
      setMonthlyReviewMissing(null);
      setMonthlyReviewMissing(liveMonthlyMissingReviews);
    } catch (err) {
      console.error(err);
      setMonthlyReviewError("Nu am putut verifica reviziile lunare.");
    } finally {
      setMonthlyReviewChecking(false);
    }
  }

  function selectTechnicianById(technicianId: string) {
    setSelectedTechnicianId(technicianId);
    setReportMessage("");
    setReportError("");
  }

  function resetTechnicianToCurrentUser() {
    const defaultTechnician = technicianOptions.find(
      (item) => item.id === currentTechnicianId || item.uid === currentTechnicianId
    );
    setSelectedTechnicianId(defaultTechnician?.id || currentTechnicianId);
    technicianDefaultInitializedRef.current = Boolean(defaultTechnician || currentTechnicianId);
  }

  function getClientEmail(client: MaintenanceClient): string {
    return (client.emails?.[0] || client.email || "").trim();
  }

  function buildEmailDraft(input: {
    reportType: ReportType;
    dateText: string;
    timeText: string;
    maintenanceCompany: string;
  }) {
    const label = input.reportType === "interventie" ? "interventie" : "revizie";
    const subject = `Raport ${label} ${input.dateText} ${input.timeText}`;
    const body = [
      "Buna ziua,",
      "",
      `Aveti atasat raportul de ${label} din data de ${input.dateText}.`,
      "",
      `Cu drag, echipa ${input.maintenanceCompany || "mentenanta"}`,
      "0314337006",
    ].join("\n");
    return { label, subject, body };
  }

  async function runGenerateReport(
    type: ReportType,
    updateBackgroundMessage: (message: string) => void
  ) {
    if (!selectedClient) {
      const message = "Selecteaza un client din sugestii.";
      setReportError(message);
      throw new Error(message);
    }

    const liftValue = reportLift.trim();
    const addressValue = reportAddress.trim();
    const commentsValue = reportComments.trim();
    if (!liftValue || !addressValue) {
      const message = "Completeaza adresa si liftul inainte de generare.";
      setReportError(message);
      throw new Error(message);
    }

    if (!selectedTechnician) {
      const message = "Selecteaza un tehnician din sugestii.";
      setReportError(message);
      throw new Error(message);
    }

    const clientEmail = getClientEmail(selectedClient);
    if (!clientEmail) {
      const message = "Clientul nu are adresa de email.";
      setReportError(message);
      throw new Error(message);
    }

    setReportGenerating(true);
    setReportError("");
    setReportMessage("Se genereaza PDF-ul si se pregatesc atasamentele...");
    updateBackgroundMessage("Se genereaza PDF-ul si se pregatesc atasamentele...");
    setLastGeneratedReport(null);

    const branding = resolveBrandingForCompany(selectedClient.maintenanceCompany || "", brandingItems);

    try {
      setReportError("");
      setReportMessage("Se genereaza PDF-ul si se pregateste emailul cu atasamente...");
      updateBackgroundMessage("Se genereaza PDF-ul si se pregateste emailul cu atasamente...");

      const now = new Date();
      const dateText = now.toLocaleDateString("ro-RO");
      const timeText = now.toLocaleTimeString("ro-RO");
      const pdfBlob = await buildMaintenancePdfBlob({
        client: selectedClient,
        lift: {
          id: `lift_${liftValue}`,
          label: `Lift ${liftValue}`,
          serialNumber: liftValue,
          manufacturer: "",
          installYear: "",
          maintenanceCompany: selectedClient.maintenanceCompany || "",
          maintenanceEmail: "",
          inspectionExpiryDate: selectedClient.expiryDate || "",
          notes: "",
        },
        branding,
        report: {
          reportType: type,
          createdAt: now.getTime(),
          dateText,
          timeText,
          address: addressValue,
          locationText: addressValue,
          technicianName: selectedTechnician.fullName,
          technicianComments: commentsValue,
          continutRaport:
            type === "interventie"
              ? "S-a efectuat interventia conform sesizarii clientului. Instalatia a fost verificata si s-au constatat urmatoarele:"
              : reviewStandardText(liftValue, selectedLiftRevisionType),
        },
      });

      const fileType = type === "interventie" ? "interventie" : "revizie";
      const reportId = generateReportId(now);
      const fileName = `${fileType}-${selectedClient.name || "client"}-${reportId}.pdf`
        .toLowerCase()
        .replace(/[^a-z0-9_.-]+/g, "-");

      const emailDraft = buildEmailDraft({
        reportType: fileType,
        dateText,
        timeText,
        maintenanceCompany: selectedClient.maintenanceCompany,
      });

      const historyItem = await saveMaintenanceReportHistory({
        client: selectedClient,
        reportType: fileType,
        address: addressValue,
        lift: liftValue,
        technicianName: selectedTechnician.fullName,
        comments: commentsValue,
        pdfBlob,
        imageFiles: reportImageFiles,
        fileName,
        createdAt: now.getTime(),
        dateText,
        timeText,
      });

      setReportMessage("PDF-ul este salvat. Se trimite emailul cu PDF-ul si pozele atasate...");
      updateBackgroundMessage("PDF salvat. Emailul si atasamentele se trimit prin Gmail...");
      const gmailResult = await sendSharedMaintenanceGmailReport({
        companyId: historyItem.companyId,
        clientId: selectedClient.id,
        clientName: selectedClient.name || "",
        reportId: historyItem.id,
        recipientEmail: clientEmail,
        subject: emailDraft.subject,
        body: emailDraft.body,
        pdfPath: historyItem.pdfPath,
        fileName: historyItem.fileName || fileName,
        attachments: (historyItem.images || [])
          .map((image) => ({
            path: image.path,
            fileName: image.name,
            contentType: image.contentType,
          }))
          .filter((attachment) => attachment.path),
      });

      const shareInfo: GeneratedReportShare = {
        clientName: selectedClient.name || "",
        clientEmail,
        senderEmail: gmailResult.senderEmail || gmailSenderEmail,
        reportType: fileType,
        dateText,
        timeText,
        maintenanceCompany: selectedClient.maintenanceCompany,
        pdfUrl: historyItem.pdfUrl,
      };

      setLastGeneratedReport(shareInfo);
      setReportImageFiles([]);
      resetTechnicianToCurrentUser();

      setReportMessage(`Raportul ${fileType} a fost trimis catre ${clientEmail} de pe ${gmailResult.senderEmail || gmailSenderEmail}, cu PDF-ul si pozele atasate.`);
    } catch (err) {
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : "";
      setReportMessage("");
      setReportError(`Nu am putut genera PDF-ul sau trimite emailul Gmail.${errorMessage ? ` Detalii: ${errorMessage}` : ""}`);
      throw err;
    } finally {
      setReportGenerating(false);
    }
  }

  async function handleGenerateReport(type: ReportType) {
    const task = startMaintenanceReportTask((updateMessage) =>
      runGenerateReport(type, updateMessage)
    );
    if (!task.started) {
      setReportMessage("Exista deja un raport in curs. Il finalizez in fundal.");
    }
  }

  useEffect(() => {
    return subscribeMaintenanceReportTask((task) => {
      if (task.state === "running") {
        setReportGenerating(true);
        setReportError("");
        setReportMessage(task.message);
      } else if (task.state === "error") {
        setReportGenerating(false);
        setReportMessage("");
        setReportError(`Raportul din fundal a esuat. ${task.error}`);
      } else if (task.state === "success") {
        setReportGenerating(false);
      }
    });
  }, []);

  generateReportRef.current = handleGenerateReport;

  useEffect(() => {
    if (
      !assistantReportRequest ||
      assistantReportRequest.submitMode !== "send" ||
      !assistantReportRequest.resolvedClientId ||
      assistantReportRequest.resolvedClientId !== selectedClientId ||
      !selectedClient ||
      reportGenerating
    ) {
      return;
    }

    if (!reportAddress) {
      if (reportAddressOptions.length > 1) {
        setReportMessage("Selecteaza adresa corecta. Raportul nu va fi trimis pana atunci.");
        highlightAssistantElement("[data-assistant-field='maintenance-report-address']");
      }
      return;
    }

    if (!reportLift) {
      if (reportLiftOptions.length > 1) {
        setReportMessage("Selecteaza liftul corect. Raportul nu va fi trimis pana atunci.");
        highlightAssistantElement("[data-assistant-field='maintenance-report-lift']");
      }
      return;
    }

    if (!selectedTechnician) {
      setReportMessage("Selecteaza tehnicianul. Raportul nu va fi trimis pana atunci.");
      highlightAssistantElement("[data-assistant-field='maintenance-report-technician']");
      return;
    }

    if (assistantReportExecutionRef.current === assistantReportRequest.requestId) return;
    assistantReportExecutionRef.current = assistantReportRequest.requestId;
    const reportType = assistantReportRequest.reportType;
    setAssistantReportRequest(null);
    setReportMessage("Datele sunt validate. Generez PDF-ul si trimit emailul...");
    void generateReportRef.current(reportType);
  }, [
    assistantReportRequest,
    reportAddress,
    reportAddressOptions.length,
    reportGenerating,
    reportLift,
    reportLiftOptions.length,
    selectedClient,
    selectedClientId,
    selectedTechnician,
  ]);

  function renderMaintenanceNav() {
    return (
      <div className="maintenance-nav" aria-label="Navigare mentenanta">
        {MAINTENANCE_TABS.map((tab) => {
          const Icon = tab.icon;
          const badge = getTabBadge(tab.id);
          const active = activeMaintenanceTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              className={`maintenance-nav-item ${active ? "active" : ""}`}
              onClick={() => openMaintenanceTab(tab.id)}
              aria-pressed={active}
            >
              <span className="maintenance-nav-item__icon"><Icon size={18} /></span>
              <span className="maintenance-nav-item__copy">
                <strong>{tab.title}</strong>
                <small>{tab.description}</small>
              </span>
              {badge ? <span className="maintenance-nav-item__badge">{badge}</span> : null}
            </button>
          );
        })}
      </div>
    );
  }

  function renderAttentionList() {
    const expiring = liveExpiredAndNextMonthExpiringLifts.slice(0, 4);
    const noEmail = clientsWithoutEmail.slice(0, 4);
    const reports = recentReports.slice(0, 4);
    const hasItems = expiring.length > 0 || noEmail.length > 0 || reports.length > 0;

    if (!hasItems) {
      return (
        <div className="maintenance-attention-empty">
          <CheckCircle2 size={18} />
          <span>Nu sunt atentionari majore acum.</span>
        </div>
      );
    }

    return (
      <div className="maintenance-attention-list">
        {expiring.map((item) => (
          <button key={`dashboard_expiring_${item.clientId}_${item.lift}`} type="button" onClick={() => navigate(`/maintenance/${item.clientId}`)}>
            <AlertTriangle size={16} />
            <span>
              <strong>Lift expirat / aproape expirat</strong>
              <small>{item.clientName} · {item.lift} · {item.expiryDate}</small>
            </span>
          </button>
        ))}
        {noEmail.map((client) => (
          <button key={`dashboard_no_email_${client.id}`} type="button" onClick={() => navigate(`/maintenance/${client.id}`)}>
            <AlertTriangle size={16} />
            <span>
              <strong>Client fara email</strong>
              <small>{client.name || "Fara nume"} · {client.maintenanceCompany || "-"}</small>
            </span>
          </button>
        ))}
        {reports.map((report) => (
          <button key={`dashboard_report_${report.clientId}_${report.id}`} type="button" onClick={() => navigate(`/maintenance/${report.clientId}`)}>
            <FileText size={16} />
            <span>
              <strong>Raport recent</strong>
              <small>{report.clientName} · {report.reportType} · {report.dateText}</small>
            </span>
          </button>
        ))}
      </div>
    );
  }

  function renderDashboardSection() {
    return (
      <div className="maintenance-tab-panel">
        <div className="maintenance-dashboard-grid">
          <div className="kpi-card">
            <div className="kpi-label">Total clienti</div>
            <div className="kpi-value">{clients.length}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Total lifturi</div>
            <div className="kpi-value">{liveTotalLifts}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Revizii lipsa luna curenta</div>
            <div className="kpi-value">{liveMonthlyMissingReviews.length}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Expirate / expira curand</div>
            <div className="kpi-value">{liveExpiredAndNextMonthExpiringLifts.length}</div>
          </div>
        </div>

        {liveStatsError && <div className="tool-message">{liveStatsError}</div>}

        <div className="maintenance-dashboard-split">
          <div className="panel maintenance-action-panel maintenance-dashboard-quick-actions">
            <h2 className="panel-title">Actiuni rapide</h2>
            <div className="maintenance-action-grid">
              <button className="maintenance-action-card" type="button" onClick={() => openMaintenanceTab("report")}>
                <FileText size={20} />
                <span><strong>Genereaza raport</strong><small>PDF, poze si email Gmail.</small></span>
              </button>
              <button className="maintenance-action-card" type="button" onClick={() => openMaintenanceTab("clients", { assistant: "client" })}>
                <PlusCircle size={20} />
                <span><strong>Adauga client</strong><small>Client, adrese si lifturi.</small></span>
              </button>
              <button className="maintenance-action-card" type="button" onClick={() => openMaintenanceTab("checks")}>
                <ClipboardCheck size={20} />
                <span><strong>Verifica revizii</strong><small>Revizii lipsa si expirari.</small></span>
              </button>
              <button className="maintenance-action-card" type="button" onClick={() => openMaintenanceTab("parts")}>
                <PackageSearch size={20} />
                <span><strong>Piese</strong><small>Comenzi si oferte piese.</small></span>
              </button>
            </div>
          </div>

          <div className="panel">
            <h2 className="panel-title">Atentie</h2>
            {renderAttentionList()}
          </div>
        </div>
      </div>
    );
  }

  function renderReportSection() {
    return (
      <div id="maintenance-report-generator" className="maintenance-tab-panel" data-assistant-section="maintenance-report-generator">
        {reportError && (
          <div className="tool-message maintenance-gmail-auth-message" role="alert">
            <span>{reportError}</span>
          </div>
        )}
        {reportMessage && (
          <div className="tool-message success-message maintenance-gmail-auth-message">
            <span>{reportMessage}</span>
          </div>
        )}

        {lastGeneratedReport && (
          <div className="panel maintenance-generated-report">
            <div>
              <h2 className="panel-title">Email trimis catre {lastGeneratedReport.clientName || "client"}</h2>
              <p className="tools-subtitle">Destinatar: {lastGeneratedReport.clientEmail || "-"} · Expeditor: {lastGeneratedReport.senderEmail} · PDF si poze atasate.</p>
            </div>
            <div className="maintenance-actions">
              {lastGeneratedReport.pdfUrl ? (
                <button
                  className="secondary-btn"
                  type="button"
                  onClick={() =>
                    void downloadFileFromUrl({
                      url: lastGeneratedReport.pdfUrl,
                      fileName: `${lastGeneratedReport.reportType}-${lastGeneratedReport.clientName || "client"}-${lastGeneratedReport.dateText}.pdf`,
                    })
                  }
                >
                  <Download size={15} /> Download PDF
                </button>
              ) : null}
            </div>
          </div>
        )}

        <div className="maintenance-report-steps">
          <div id="maintenance-report-form-start" className="panel maintenance-step-card" data-assistant-step="report-client">
            <div className="maintenance-step-card__head">
              <span>Pas 1</span>
              <h2>Client</h2>
            </div>
            <div className="tool-form-block" style={{ position: "relative" }}>
              <label className="tool-form-label">Cautare client</label>
              <input
                className="tool-input"
                data-assistant-field="maintenance-report-client"
                value={reportSearch}
                onChange={handleReportSearchChange}
                onFocus={() => setReportSuggestionsOpen(!selectedClient && reportSearch.trim().length >= 2)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setReportSuggestionsOpen(false);
                  }
                }}
                placeholder="Ex: Razvan / Aurel Vlaicu / 210869"
              />
              {reportSuggestionsOpen && !selectedClient && reportSuggestions.length > 0 && reportSearch.trim().length >= 2 && (
                <div className="maintenance-suggestion-list" role="listbox" aria-label="Sugestii client">
                  {reportSuggestions.map((client) => (
                    <button key={`report_suggestion_${client.id}`} type="button" role="option" aria-selected="false" onClick={() => selectReportClient(client)}>
                      <strong>{client.name || "Fara nume"}</strong>
                      <small>Adresa: {client.address || "-"} · Lift: {client.liftNumber || client.liftNumbers?.[0] || "-"}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="maintenance-readonly-grid">
              <div><span>Nume client</span><strong>{selectedClient?.name || "-"}</strong></div>
              <div><span>Firma mentenanta</span><strong>{selectedClient?.maintenanceCompany || "-"}</strong></div>
            </div>
          </div>

          <div className="panel maintenance-step-card" data-assistant-step="report-lift">
            <div className="maintenance-step-card__head">
              <span>Pas 2</span>
              <h2>Lift</h2>
            </div>
            <div className="tool-form-grid">
              <div className="tool-form-block">
                <label className="tool-form-label">Adresa client</label>
                <select
                  className="tool-input"
                  data-assistant-field="maintenance-report-address"
                  value={reportAddress}
                  onChange={(e) => {
                    setReportAddress(e.target.value);
                    setReportLift("");
                  }}
                  disabled={!selectedClient}
                >
                  <option value="">Selecteaza adresa</option>
                  {reportAddressOptions.map((address) => (
                    <option key={`report_address_${address}`} value={address}>{address}</option>
                  ))}
                </select>
              </div>
              <div className="tool-form-block">
                <label className="tool-form-label">Lift</label>
                <select className="tool-input" data-assistant-field="maintenance-report-lift" value={reportLift} onChange={(e) => setReportLift(e.target.value)} disabled={!selectedClient}>
                  <option value="">Selecteaza liftul</option>
                  {reportLiftOptions.map((lift) => (
                    <option key={`report_lift_${lift}`} value={lift}>{lift}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="panel maintenance-step-card" data-assistant-step="report-details">
            <div className="maintenance-step-card__head">
              <span>Pas 3</span>
              <h2>Detalii raport</h2>
            </div>
            <div className="tool-form-grid">
              <div className="tool-form-block">
                <label className="tool-form-label">Tip raport</label>
                <select className="tool-input" data-assistant-field="maintenance-report-type" value={reportTypeDraft} onChange={(e) => setReportTypeDraft(e.target.value as ReportType)}>
                  <option value="revizie">Revizie</option>
                  <option value="interventie">Interventie</option>
                </select>
              </div>
              <div className="tool-form-block" style={{ gridColumn: "1 / -1" }}>
                <label className="tool-form-label">Comentarii tehnician</label>
                <textarea
                  className="tool-input"
                  data-assistant-field="maintenance-report-comments"
                  value={reportComments}
                  onChange={(e) => setReportComments(e.target.value)}
                  placeholder="Descrie interventia, modificarile sau recomandarile."
                  rows={4}
                />
              </div>
              <div className="tool-form-block">
                <label className="tool-form-label">Poze raport</label>
                <input className="tool-input" data-assistant-field="maintenance-report-photos" type="file" accept="image/*" multiple onChange={(e) => setReportImageFiles(Array.from(e.target.files || []))} />
                <div className="simple-list-subtitle">{reportImageFiles.length ? `${reportImageFiles.length} poze selectate` : "Nu ai selectat poze."}</div>
              </div>
              <div className="tool-form-block maintenance-technician-picker">
                <label className="tool-form-label">Tehnician</label>
                <select className="tool-input" aria-label="Tehnician" data-assistant-field="maintenance-report-technician" value={selectedTechnicianId} onChange={(event) => selectTechnicianById(event.target.value)}>
                  <option value="">Selecteaza tehnicianul</option>
                  {technicianOptions.map((technician) => (
                    <option key={`technician_${technician.id}`} value={technician.id}>
                      {technician.fullName}
                    </option>
                  ))}
                </select>
                <div className="simple-list-subtitle">Implicit este selectat utilizatorul autentificat.</div>
              </div>
            </div>
          </div>

          <div className="panel maintenance-step-card maintenance-step-card--send" data-assistant-step="report-send">
            <div className="maintenance-step-card__head">
              <span>Pas 4</span>
              <h2>Trimitere</h2>
            </div>
            <div className="tool-form-block">
              <label className="tool-form-label">Cont Gmail expeditor</label>
              <input className="tool-input" data-assistant-field="maintenance-report-sender" value={gmailSenderEmail} readOnly />
              <div className="simple-list-subtitle">
                Emailul este trimis automat de server prin contul comun autorizat. Nu este necesara autentificarea Gmail pe telefon.
              </div>
            </div>
            <div className="tool-form-actions">
              <button className="primary-btn maintenance-send-btn" data-assistant-action="maintenance-generate-selected-report" type="button" title="Genereaza si trimite raportul pentru tipul selectat" onClick={() => void handleGenerateReport(reportTypeDraft)} disabled={reportGenerating}>
                {reportGenerating ? "Se genereaza..." : "Genereaza tipul selectat"}
              </button>
              <button className="secondary-btn" data-assistant-action="maintenance-generate-review-report" type="button" title="Genereaza PDF-ul si trimite automat emailul cu atasamente" onClick={() => void handleGenerateReport("revizie")} disabled={reportGenerating}>
                Genereaza raport revizie
              </button>
              <button className="secondary-btn" data-assistant-action="maintenance-generate-intervention-report" type="button" title="Genereaza raportul de interventie si trimite automat emailul" onClick={() => void handleGenerateReport("interventie")} disabled={reportGenerating}>
                Genereaza raport interventie
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderPartsSection() {
    return (
      <div className="maintenance-tab-panel">
        <div className="panel maintenance-parts-bridge" data-assistant-action="maintenance-parts">
          <div>
            <h2 className="panel-title">Comenzi piese lift</h2>
            <p className="tools-subtitle">Modulul de piese ramane dedicat pentru comenzi, oferte, notificari si status montaj.</p>
          </div>
          <div className="maintenance-actions">
            <Link className="primary-btn" to="/maintenance/orders">Deschide comenzi piese</Link>
            <Link className="secondary-btn" to="/maintenance/parts">Ruta /maintenance/parts</Link>
          </div>
        </div>
      </div>
    );
  }

  function renderClientFormPanel() {
    if (!clientFormVisible) return null;

    return (
      <div id="maintenance-client-form" className="panel maintenance-client-form-panel" data-assistant-action="maintenance-add-client">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Client nou</h2>
            <p className="panel-subtitle">Completeaza clientul, adresele si lifturile, apoi salveaza.</p>
          </div>
          <button className="secondary-btn" type="button" onClick={() => setClientFormVisible(false)}>Inchide</button>
        </div>

        {error && <div className="tool-message">{error}</div>}
        {message && <div className="tool-message success-message">{message}</div>}

        <div className="tool-form-grid">
          <div className="tool-form-block">
            <label className="tool-form-label">Nume</label>
            <input className="tool-input" data-assistant-field="maintenance-client-name" value={clientForm.name} onChange={(e) => setClientForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Ex: Razvan Banescu" />
          </div>
          <div className="tool-form-block">
            <label className="tool-form-label">E-mail</label>
            <input className="tool-input" data-assistant-field="maintenance-client-email" value={clientForm.email} onChange={(e) => setClientForm((prev) => ({ ...prev, email: e.target.value }))} placeholder="contact@client.ro" />
          </div>
          <div className="tool-form-block">
            <label className="tool-form-label">Persoana contact</label>
            <input className="tool-input" data-assistant-field="maintenance-client-contact-person" value={clientForm.contactPerson} onChange={(e) => setClientForm((prev) => ({ ...prev, contactPerson: e.target.value }))} placeholder="Ex: Popescu Ion" />
          </div>
          <div className="tool-form-block">
            <label className="tool-form-label">Telefon contact</label>
            <input className="tool-input" data-assistant-field="maintenance-client-contact-phone" value={clientForm.contactPhone} onChange={(e) => setClientForm((prev) => ({ ...prev, contactPhone: e.target.value }))} placeholder="07xx xxx xxx" />
          </div>
          <div className="tool-form-block">
            <label className="tool-form-label">Firma mentenanta</label>
            <input className="tool-input" data-assistant-field="maintenance-client-company" value={clientForm.maintenanceCompany} onChange={(e) => setClientForm((prev) => ({ ...prev, maintenanceCompany: e.target.value }))} placeholder="ISL ELEVATOR SOLUTIONS SRL" />
          </div>
          <div className="tool-form-block tool-form-block-full">
            <label className="tool-form-label">Adrese si lifturi</label>
            <div className="simple-list">
              {clientForm.addresses.map((address, addressIndex) => (
                <div className="simple-list-item" key={address.id} style={{ alignItems: "stretch" }}>
                  <div className="simple-list-text">
                    <div className="simple-list-label">Adresa {addressIndex + 1}</div>
                    <input className="tool-input" data-assistant-field="maintenance-client-address" value={address.address} onChange={(e) => updateClientFormAddress(address.id, e.target.value)} placeholder="Str. Aurel Vlaicu nr. 91 Sector 2" />
                    <div className="simple-list" style={{ marginTop: 10 }}>
                      {address.lifts.map((lift, liftIndex) => (
                        <div className="simple-list-item" key={lift.id}>
                          <div className="simple-list-text">
                            <div className="simple-list-label">Lift {liftIndex + 1}</div>
                            <div className="tool-form-grid">
                              <div className="tool-form-block">
                                <label className="tool-form-label">Numar lift</label>
                                <input className="tool-input" data-assistant-field="maintenance-client-lift-number" value={lift.liftNumber} onChange={(e) => updateClientFormLift(address.id, lift.id, "liftNumber", e.target.value)} placeholder="210869" />
                              </div>
                              <div className="tool-form-block">
                                <label className="tool-form-label">Exp. Date</label>
                                <input className="tool-input" data-assistant-field="maintenance-client-expiry-date" type="date" value={lift.expiryDate} onChange={(e) => updateClientFormLift(address.id, lift.id, "expiryDate", e.target.value)} />
                              </div>
                              <div className="tool-form-block">
                                <label className="tool-form-label">Tip revizie</label>
                                <select className="tool-input" data-assistant-field="maintenance-client-revision-type" value={lift.revisionType} onChange={(e) => updateClientFormLift(address.id, lift.id, "revisionType", e.target.value)}>
                                  <option value="R2">R2</option>
                                  <option value="R1">R1</option>
                                </select>
                              </div>
                            </div>
                          </div>
                          <button className="danger-btn" type="button" onClick={() => removeClientFormLift(address.id, lift.id)} disabled={address.lifts.length <= 1}>
                            Sterge lift
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="maintenance-actions" style={{ marginTop: 10 }}>
                      <button className="secondary-btn" type="button" onClick={() => addClientFormLift(address.id)}>+ Lift</button>
                      <button className="danger-btn" type="button" onClick={() => removeClientFormAddress(address.id)} disabled={clientForm.addresses.length <= 1}>Sterge adresa</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="tool-form-actions">
              <button className="secondary-btn" type="button" onClick={addClientFormAddress}>+ Adresa</button>
            </div>
          </div>
        </div>

        <div className="tool-form-actions">
          <button className="primary-btn" data-assistant-action="maintenance-save-client" type="button" onClick={() => void handleCreateClient()} disabled={submitting}>
            {submitting ? "Se salveaza..." : "Salveaza client"}
          </button>
        </div>
      </div>
    );
  }

  function renderClientsSection() {
    return (
      <div className="maintenance-tab-panel" data-assistant-section="maintenance-clients">
        <div className="panel maintenance-clients-head">
          <div>
            <h2 className="panel-title">Clienti mentenanta</h2>
            <p className="panel-subtitle">Cauta dupa nume, adresa sau lift si gestioneaza fiecare client.</p>
          </div>
          <button className="primary-btn maintenance-big-action" data-assistant-action="maintenance-add-client" type="button" title="Adauga client nou cu adrese si lifturi" onClick={() => setClientFormVisible(true)}>
            <PlusCircle size={17} /> Adauga client nou
          </button>
        </div>

        {renderClientFormPanel()}

        <div className="panel">
          <div className="tool-form-block maintenance-search">
            <label className="tool-form-label">Cauta client</label>
            <div className="maintenance-search-control">
              <Search size={17} />
              <input className="tool-input" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Ex: Razvan / Aurel Vlaicu / 210869" />
            </div>
          </div>

          {loading ? (
            <p className="tools-subtitle">Se incarca datele...</p>
          ) : filteredClients.length === 0 ? (
            <p className="tools-subtitle">Nu exista clienti pentru cautarea curenta.</p>
          ) : (
            <div className="maintenance-client-grid">
              {filteredClients.map((client) => {
                const displayEmails = Array.from(new Set(((client.emails || []).length ? client.emails : client.email ? [client.email] : []).filter(Boolean)));
                const liftCount = getClientLiftCount(client);
                const clientExpiring = liveExpiredAndNextMonthExpiringLifts.filter((item) => item.clientId === client.id);
                return (
                  <article key={client.id} className="maintenance-client-card">
                    <div className="maintenance-client-card__head">
                      <div>
                        <h3>{client.name || "Fara nume"}</h3>
                        <span>{client.maintenanceCompany || "Fara firma"}</span>
                      </div>
                      <span className={clientExpiring.length ? "badge-orange" : "badge-normal"}>
                        {clientExpiring.length ? `${clientExpiring.length} atentionari` : "OK"}
                      </span>
                    </div>
                    <div className="maintenance-client-card__meta">
                      <span>{displayEmails.length ? displayEmails.join(", ") : "Fara email"}</span>
                      <span>{liftCount} lifturi</span>
                      <span>Expirari: {clientExpiring.length || 0}</span>
                    </div>
                    <div className="maintenance-actions">
                      <button className="secondary-btn" type="button" onClick={() => navigate(`/maintenance/${client.id}`)}>Detalii</button>
                      <button className="secondary-btn" type="button" onClick={() => navigate(`/maintenance/${client.id}`)}>Editeaza</button>
                      <button className="danger-btn" type="button" onClick={() => void handleDeleteClient(client)}>
                        <Trash2 size={14} /> Sterge
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderCompaniesSection() {
    return (
      <div className="maintenance-tab-panel">
        <div className="panel" data-assistant-action="maintenance-branding">
          <h2 className="panel-title">Firme / Branding PDF</h2>
          <p className="panel-subtitle">Logo-ul si stampila se aleg automat in raport dupa firma de mentenanta.</p>

          {brandingError && <div className="tool-message">{brandingError}</div>}
          {brandingMessage && <div className="tool-message success-message">{brandingMessage}</div>}

          <div className="tool-form-grid">
            <div className="tool-form-block">
              <label className="tool-form-label">Firma mentenanta</label>
              <input className="tool-input" value={brandingCompanyName} onChange={(e) => setBrandingCompanyName(e.target.value)} placeholder="Ex: KLEMAN sau BREX" />
            </div>
            <div className="tool-form-block">
              <label className="tool-form-label">Logo firma</label>
              <input className="tool-input" type="file" accept="image/*" onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)} />
              <div className="simple-list-subtitle">{logoFile ? logoFile.name : "Nu ai selectat logo."}</div>
            </div>
            <div className="tool-form-block">
              <label className="tool-form-label">Stampila firma</label>
              <input className="tool-input" type="file" accept="image/*" onChange={(e) => setStampFile(e.target.files?.[0] ?? null)} />
              <div className="simple-list-subtitle">{stampFile ? stampFile.name : "Nu ai selectat stampila."}</div>
            </div>
          </div>
          <div className="tool-form-actions">
            <button className="primary-btn" type="button" onClick={() => void handleSaveBranding()} disabled={brandingSaving}>
              {brandingSaving ? "Se incarca..." : "Salveaza branding firma"}
            </button>
          </div>
        </div>

        <div className="maintenance-branding-grid">
          {brandingItems.length === 0 ? (
            <div className="panel"><p className="tools-subtitle">Nu exista branding salvat inca.</p></div>
          ) : (
            brandingItems.map((item) => (
              <article key={item.id} className="maintenance-branding-card">
                <div>
                  <h3>{item.companyName}</h3>
                  <small>Cheie interna: {item.companyKey}</small>
                </div>
                <div className="maintenance-branding-preview">
                  {item.logoUrl ? <img src={item.logoUrl} alt={`Logo ${item.companyName}`} /> : <span>Fara logo</span>}
                  {item.stampUrl ? <img src={item.stampUrl} alt={`Stampila ${item.companyName}`} /> : <span>Fara stampila</span>}
                </div>
                <button className="secondary-btn" type="button" onClick={() => handleLoadBrandingCompany(item.companyName)}>Editeaza</button>
              </article>
            ))
          )}
        </div>
      </div>
    );
  }

  function renderChecksFilters() {
    return (
      <div className="tool-form-grid maintenance-check-filters">
        <div className="tool-form-block">
          <label className="tool-form-label">Firma</label>
          <select className="tool-input" value={checkCompanyFilter} onChange={(e) => setCheckCompanyFilter(e.target.value)}>
            <option value="">Toate firmele</option>
            {maintenanceCompanyOptions.map((company) => <option key={company} value={company}>{company}</option>)}
          </select>
        </div>
        <div className="tool-form-block">
          <label className="tool-form-label">Client</label>
          <select className="tool-input" value={checkClientFilter} onChange={(e) => setCheckClientFilter(e.target.value)}>
            <option value="">Toti clientii</option>
            {checkClientOptions.map((client) => <option key={client} value={client}>{client}</option>)}
          </select>
        </div>
        <div className="tool-form-block">
          <label className="tool-form-label">Adresa</label>
          <select className="tool-input" value={checkAddressFilter} onChange={(e) => setCheckAddressFilter(e.target.value)}>
            <option value="">Toate adresele</option>
            {checkAddressOptions.map((address) => <option key={address} value={address}>{address}</option>)}
          </select>
        </div>
      </div>
    );
  }

  function renderChecksSection() {
    const missingList = monthlyReviewMissing ? monthlyReviewMissing.filter(checkFilterMatches) : filteredMonthlyMissingReviews;
    return (
      <div className="maintenance-tab-panel">
        <div className="panel" data-assistant-action="maintenance-checks">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Verificari lunare</h2>
              <p className="panel-subtitle">Revizii lipsa si lifturi expirate / care expira curand.</p>
            </div>
            <button className="primary-btn maintenance-big-action" type="button" onClick={() => void handleCheckMonthlyReviews()} disabled={monthlyReviewChecking || loading}>
              {monthlyReviewChecking ? "Se verifica..." : "Verifica luna curenta"}
            </button>
          </div>
          {monthlyReviewError && <div className="tool-message">{monthlyReviewError}</div>}
          {renderChecksFilters()}
          <div className="maintenance-dashboard-grid">
            <div className="kpi-card"><div className="kpi-label">Fara revizie</div><div className="kpi-value">{missingList.length}</div></div>
            <div className="kpi-card"><div className="kpi-label">Expirate / curand</div><div className="kpi-value">{filteredExpiredLifts.length}</div></div>
          </div>
        </div>

        <div className="maintenance-two-cols">
          <div className="panel">
            <h3 className="panel-title">Lifturi fara revizie</h3>
            {missingList.length === 0 ? (
              <p className="tools-subtitle">Toate lifturile filtrate au revizie luna aceasta.</p>
            ) : (
              <div className="simple-list maintenance-scroll-list">
                {missingList.map((item) => (
                  <div className="simple-list-item" key={`missing_review_${item.clientId}_${item.address}_${item.lift}`}>
                    <div className="simple-list-text">
                      <div className="simple-list-label">Lift: {item.lift}</div>
                      <div className="simple-list-subtitle">{item.clientName} · {item.address} · {item.maintenanceCompany}</div>
                    </div>
                    <button className="secondary-btn" type="button" onClick={() => navigate(`/maintenance/${item.clientId}`)}>Detalii</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="panel">
            <h3 className="panel-title">Lifturi expirate / expira curand</h3>
            {filteredExpiredLifts.length === 0 ? (
              <p className="tools-subtitle">Nu sunt expirari pentru filtrele curente.</p>
            ) : (
              <div className="simple-list maintenance-scroll-list">
                {filteredExpiredLifts.map((item) => (
                  <div className="simple-list-item" key={`expiring_${item.clientId}_${item.address}_${item.lift}`}>
                    <div className="simple-list-text">
                      <div className="simple-list-label">Lift: {item.lift} · Exp. Date: {item.expiryDate}</div>
                      <div className="simple-list-subtitle">{item.clientName} · {item.address} · {item.maintenanceCompany}</div>
                    </div>
                    <button className="secondary-btn" type="button" onClick={() => navigate(`/maintenance/${item.clientId}`)}>Detalii</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderHistorySection() {
    return (
      <div className="maintenance-tab-panel" data-assistant-action="maintenance-history">
        <div className="panel">
          <h2 className="panel-title">Istoric rapoarte</h2>
          <div className="tool-form-grid">
            <div className="tool-form-block">
              <label className="tool-form-label">Cautare</label>
              <input className="tool-input" value={reportHistorySearch} onChange={(e) => setReportHistorySearch(e.target.value)} placeholder="Client, lift, adresa, tehnician" />
            </div>
            <div className="tool-form-block">
              <label className="tool-form-label">Luna</label>
              <input className="tool-input" type="month" value={reportHistoryMonth} onChange={(e) => setReportHistoryMonth(e.target.value)} />
            </div>
            <div className="tool-form-block">
              <label className="tool-form-label">Tip raport</label>
              <select className="tool-input" value={reportHistoryType} onChange={(e) => setReportHistoryType(e.target.value)}>
                <option value="">Toate</option>
                <option value="revizie">Revizie</option>
                <option value="interventie">Interventie</option>
              </select>
            </div>
            <div className="tool-form-block">
              <label className="tool-form-label">Tehnician</label>
              <select className="tool-input" value={reportHistoryTechnician} onChange={(e) => setReportHistoryTechnician(e.target.value)}>
                <option value="">Toti tehnicienii</option>
                {reportTechnicianOptions.map((technician) => <option key={technician} value={technician}>{technician}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="panel">
          {filteredReportHistory.length === 0 ? (
            <p className="tools-subtitle">Nu exista rapoarte pentru filtrele curente.</p>
          ) : (
            <div className="simple-list maintenance-history-list">
              {filteredReportHistory.map((report) => (
                <div className="simple-list-item" key={`${report.clientId}_${report.id}`}>
                  <div className="simple-list-text">
                    <div className="simple-list-label">{report.reportType === "interventie" ? "Interventie" : "Revizie"} · {report.clientName || "Fara client"}</div>
                    <div className="simple-list-subtitle">{report.dateText} {report.timeText} · Lift {report.lift || "-"} · {report.address || "-"}</div>
                    <div className="simple-list-subtitle">Tehnician: {report.technicianName || "-"} · Poze: {report.images?.length || 0}</div>
                    {report.comments ? <div className="simple-list-subtitle">Comentarii: {report.comments}</div> : null}
                    {report.images?.length ? (
                      <div className="maintenance-thumbs">
                        {report.images.map((image) => (
                          <button className="maintenance-thumb-btn" key={`${report.id}_${image.path || image.url}`} type="button" onClick={() => window.open(image.url, "_blank")}>
                            <img src={image.url} alt={image.name || "Poza raport"} />
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="maintenance-actions">
                    {report.pdfUrl ? (
                      <button className="secondary-btn" type="button" onClick={() => void downloadFileFromUrl({ url: report.pdfUrl, fileName: report.fileName || `raport-mentenanta-${report.id}.pdf` })}>
                        Download PDF
                      </button>
                    ) : null}
                    <button className="secondary-btn" type="button" onClick={() => navigate(`/maintenance/${report.clientId}`)}>Vezi client</button>
                    {report.images?.length ? <button className="secondary-btn" type="button" onClick={() => window.open(report.images[0].url, "_blank")}>Vezi poze</button> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderActiveMaintenanceTab() {
    if (activeMaintenanceTab === "report") return renderReportSection();
    if (activeMaintenanceTab === "parts") return renderPartsSection();
    if (activeMaintenanceTab === "clients") return renderClientsSection();
    if (activeMaintenanceTab === "lifts") {
      return (
        <div className="maintenance-tab-panel" data-assistant-section="maintenance-lifts">
          <div className="panel">
            <div className="panel-head">
              <div><h2 className="panel-title">Lifturi</h2><p className="panel-subtitle">Toate lifturile, grupate clar după client și adresă.</p></div>
              <span className="badge badge-blue">{allLiftRows.length}</span>
            </div>
            {allLiftRows.length ? (
              <div className="maintenance-lift-grid">
                {allLiftRows.map((row) => (
                  <Link key={`${row.clientId}_${row.address}_${row.lift}`} to={`/maintenance/${row.clientId}?lift=${encodeURIComponent(row.lift)}`} className="maintenance-lift-card">
                    <div><strong>{row.lift}</strong><span>{row.clientName}</span></div>
                    <dl><div><dt>Adresă</dt><dd>{row.address || "-"}</dd></div><div><dt>Firmă</dt><dd>{row.maintenanceCompany || "-"}</dd></div></dl>
                  </Link>
                ))}
              </div>
            ) : <div className="empty-state"><div className="empty-state-title">Nu există lifturi configurate</div></div>}
          </div>
        </div>
      );
    }
    if (activeMaintenanceTab === "companies") return renderCompaniesSection();
    if (activeMaintenanceTab === "history") return renderHistorySection();
    if (activeMaintenanceTab === "checks") return renderChecksSection();
    return renderDashboardSection();
  }

  if (role !== "admin" && role !== "manager") {
    return (
      <PageLayout className="maintenance-page">
        <PermissionState message="Doar adminul sau managerul pot gestiona baza de mentenanta." />
      </PageLayout>
    );
  }

  return (
    <PageLayout className="maintenance-page">
      <ActionBar
        title="Mentenanta"
        subtitle="Dashboard, rapoarte, clienti, branding, istoric si verificari lunare intr-o pagina organizata pe taburi."
        actions={[
          {
            label: "Genereaza raport",
            icon: <FileText size={16} />,
            variant: "primary",
            onClick: () => openMaintenanceTab("report", { assistant: "report" }),
            assistantAction: "maintenance-report-generator",
            tooltip: "Genereaza PDF si il trimite pe email",
          },
          {
            label: "Comenzi piese",
            icon: <PackageSearch size={16} />,
            onClick: () => openMaintenanceTab("parts"),
            assistantAction: "maintenance-parts",
            tooltip: "Deschide comenzile de piese mentenanta",
          },
        ]}
      />

      <PageQuickActions
        className="maintenance-page-quick-actions"
        actions={[
          {
            label: "Genereaza raport",
            icon: <FileText size={16} />,
            onClick: () => openMaintenanceTab("report", { assistant: "report" }),
            assistantAction: "maintenance-report-generator",
            tooltip: "Genereaza raport PDF pentru client",
            variant: "primary",
            active: activeMaintenanceTab === "report",
          },
          {
            label: "Piese",
            icon: <PackageSearch size={16} />,
            onClick: () => openMaintenanceTab("parts"),
            assistantAction: "maintenance-parts",
            tooltip: "Comenzi, oferte si status piese",
            active: activeMaintenanceTab === "parts",
          },
          {
            label: "Adauga client",
            icon: <PlusCircle size={16} />,
            onClick: () => openMaintenanceTab("clients", { assistant: "client" }),
            assistantAction: "maintenance-add-client",
            tooltip: "Adauga client nou cu adrese si lifturi",
            active: activeMaintenanceTab === "clients",
          },
          {
            label: "Firme",
            icon: <Building2 size={16} />,
            onClick: () => openMaintenanceTab("companies"),
            assistantAction: "maintenance-branding",
            tooltip: "Configureaza logo si stampila pentru rapoarte",
            active: activeMaintenanceTab === "companies",
          },
          {
            label: "Istoric",
            icon: <History size={16} />,
            onClick: () => openMaintenanceTab("history"),
            assistantAction: "maintenance-history",
            tooltip: "Vezi rapoartele generate",
            active: activeMaintenanceTab === "history",
          },
        ]}
      />

      {renderMaintenanceNav()}
      {(() => {
        const ActiveModule = getMaintenanceModule(activeMaintenanceTab).component;
        return <ActiveModule>{renderActiveMaintenanceTab()}</ActiveModule>;
      })()}
    </PageLayout>
  );
}
