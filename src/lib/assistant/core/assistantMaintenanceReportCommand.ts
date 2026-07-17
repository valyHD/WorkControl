import type {
  AssistantV3Contract,
  AssistantV3PageContext,
  AssistantV3SelectedEntity,
} from "./assistantV3Types";
import { formatAssistantReportObservation } from "./assistantReportText";

export type AssistantMaintenanceReportFields = {
  clientQuery: string;
  reportType: "revizie" | "interventie";
  observations: string;
  submitMode: "prepare" | "send";
  waitForPhotos: boolean;
};

function normalizeForMatching(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function cleanExtractedValue(value: string) {
  return value
    .replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sliceUntilCommandMarker(original: string, normalized: string) {
  const stopPatterns = [
    /(?:^|\s)(?:(?:si|iar)\s+)?(?:(?:cu|la|in)\s+)?(?:(?:rubrica|campul)\s+)?(?:observatia|observatie|observatii|mentiunea|mentiune|comentariul|comentariu)\b/,
    /(?:^|\s)(?:si|iar)\s+(?:scrie|pune|trece|noteaza|baga)\b/,
    /(?:^|\s)(?:si\s+)?(?:trimite(?:-l)?|trimita|expediaza|transmite|send)\b/,
    /(?:^|\s)(?:si\s+)?(?:asteapta|apoi)\b/,
  ];
  const indexes = stopPatterns
    .map((pattern) => normalized.search(pattern))
    .filter((index) => index >= 0);
  const end = indexes.length > 0 ? Math.min(...indexes) : original.length;
  return cleanExtractedValue(original.slice(0, end));
}

function extractClientQuery(command: string, normalized: string) {
  const clientMarker = /\bclient(?:ului|ul|u)?\s+/.exec(normalized);
  if (clientMarker?.index !== undefined) {
    const start = clientMarker.index + clientMarker[0].length;
    return sliceUntilCommandMarker(command.slice(start), normalized.slice(start));
  }

  const forMarker = /\bpentru\s+/.exec(normalized);
  if (forMarker?.index !== undefined) {
    const start = forMarker.index + forMarker[0].length;
    return sliceUntilCommandMarker(command.slice(start), normalized.slice(start)).replace(
      /^(?:client(?:ului|ul|u)?|lift(?:ul)?)\s+/i,
      ""
    );
  }

  const reportTypeMarker = /\b(?:revizie|revizia|interventie|interventia)\s+/.exec(normalized);
  if (reportTypeMarker?.index !== undefined) {
    const start = reportTypeMarker.index + reportTypeMarker[0].length;
    return sliceUntilCommandMarker(command.slice(start), normalized.slice(start)).replace(
      /^(?:(?:pentru|la)\s+)?(?:client(?:ului|ul|u)?|lift(?:ul)?)?\s*/i,
      ""
    );
  }

  return "";
}

function extractObservations(command: string, normalized: string) {
  const explicitMarker =
    /\b(?:(?:iar|si)\s+)?(?:cu|la|in)?\s*(?:(?:rubrica|campul)\s+)?(?:observatia|observatie|observatii|mentiunea|mentiune|comentariul|comentariu)(?:\s+tehnicianului)?\s*[:;-]?\s*/.exec(
      normalized
    );
  const conversationalMarker = /\b(?:iar|si)\s+(?:scrie|pune|trece|noteaza|baga)(?:\s+asa)?\s+(?!poze\b|fotografii\b)/.exec(
    normalized
  );
  const marker = explicitMarker || conversationalMarker;
  if (marker?.index === undefined) return "";
  const start = marker.index + marker[0].length;
  const originalTail = command.slice(start);
  const normalizedTail = normalized.slice(start);
  const stopPatterns = [
    /\s+(?:si\s+)?(?:asteapta|trimite(?:-l)?|trimita|expediaza|transmite)\b/,
    /\s+apoi\s+(?:dau|apas|trimit)\b/,
  ];
  const indexes = stopPatterns
    .map((pattern) => normalizedTail.search(pattern))
    .filter((index) => index >= 0);
  const end = indexes.length > 0 ? Math.min(...indexes) : originalTail.length;
  return formatAssistantReportObservation(
    cleanExtractedValue(originalTail.slice(0, end))
      .replace(
        /^(?:(?:bag(?:a|\u0103)|zi)(?:\s+(?:aici|acolo))?(?:\s+(?:asa|ca|cu))?\s+)+/i,
        ""
      )
      .replace(
        /^(?:(?:trece|scrie|pune|noteaza|notează|completeaza|completează)(?:\s+(?:aici|acolo))?(?:\s+(?:asa|așa|ca|cu))?\s+)+/i,
        ""
      )
      .replace(/^(?:este|ca|sa fie)\s+/i, "")
  );
}

type MaintenanceReportContext = Omit<Partial<AssistantV3PageContext>, "memory"> & {
  selectedEntity?: AssistantV3SelectedEntity | null;
  memory?: {
    lastEntity?:
      | AssistantV3SelectedEntity
      | {
          entityType?: string;
          entityId?: string;
          label?: string;
          query?: string;
        };
  };
};

function contextualClient(context?: MaintenanceReportContext) {
  const selected = context?.selectedEntity;
  if (selected?.type === "maintenanceClient") return selected.label || selected.id;
  const remembered = context?.memory?.lastEntity;
  if (!remembered) return "";
  const rememberedType = "type" in remembered ? remembered.type : remembered.entityType;
  if (rememberedType === "maintenanceClient") {
    return (
      remembered.label ||
      ("id" in remembered ? remembered.id : remembered.entityId) ||
      ("query" in remembered ? remembered.query : "") ||
      ""
    );
  }
  return "";
}

export function buildLocalMaintenanceReportContract(
  command: string,
  context?: MaintenanceReportContext
): AssistantV3Contract | null {
  const cleanCommand = command.replace(/\s+/g, " ").trim();
  const normalized = normalizeForMatching(cleanCommand);
  const isReportCommand =
    (/\braport(?:ul)?\b/.test(normalized) ||
      /\b(?:revizia|interventia)\b/.test(normalized)) &&
    (/\b(?:genereaza|creeaza|pregateste|fa|trimite|expediaza)\b/.test(normalized) ||
      /^(?:raport(?:ul)?\s+)?(?:de\s+)?(?:revizie|interventie)\b/.test(normalized));
  const reportType = /\binterventi(?:e|a)\b/.test(normalized)
    ? "interventie"
    : /\brevizi(?:e|a)\b/.test(normalized)
      ? "revizie"
      : null;

  if (!isReportCommand || !reportType) return null;

  const clientQuery = extractClientQuery(cleanCommand, normalized) || contextualClient(context);
  const observations = extractObservations(cleanCommand, normalized);
  const waitsForUpload =
    (normalized.includes("asteapta") || normalized.includes("astept")) &&
    ["atasez", "incarc", "pun", "adaug"].some((verb) => normalized.includes(verb)) &&
    ["poze", "fotografii"].some((noun) => normalized.includes(noun));
  const waitForPhotos =
    waitsForUpload || /\b(?:dau|apas|trimit)\s+eu\b[^.]{0,40}\b(?:send|trimite)\b/.test(normalized);
  const explicitSend =
    !waitForPhotos && /\b(?:trimite(?:-l)?|trimita|expediaza|transmite|send)\b/.test(normalized);
  const explicitPrepare =
    /\b(?:pregateste|completeaza|deschide)\b/.test(normalized) ||
    /\b(?:fara|nu)\s+(?:sa\s+)?(?:trimite|expedia|transmite)\b/.test(normalized);
  const submitMode = waitForPhotos || (explicitPrepare && !explicitSend) ? "prepare" : "send";
  const targetPage = "/maintenance?tab=report&assistant=report";

  if (!clientQuery) {
    return {
      version: "3",
      commandType: "form_fill",
      intent: "open_maintenance_report",
      toolCalls: [],
      targetPage,
      entityReferences: [],
      missingInformation: ["clientul de mentenanta"],
      confidence: 0.5,
      confirmationRequired: false,
      response: "Pentru ce client pregatesc raportul?",
    };
  }

  const fields: AssistantMaintenanceReportFields = {
    clientQuery,
    reportType,
    observations,
    submitMode,
    waitForPhotos,
  };
  const reportLabel = reportType === "interventie" ? "interventie" : "revizie";

  return {
    version: "3",
    commandType: "form_fill",
    intent: "open_maintenance_report",
    toolCalls: [
      {
        id: submitMode === "send" ? "maintenance.report.send" : "maintenance.report.prepare",
        input: { fields },
      },
    ],
    targetPage,
    entityReferences: [{ type: "maintenanceClient", query: clientQuery, id: "" }],
    missingInformation: [],
    confidence: 0.98,
    confirmationRequired: submitMode === "send",
    response:
      submitMode === "send"
        ? `Trimite raportul de ${reportLabel} pentru ${clientQuery}?`
        : waitForPhotos
          ? `Deschid raportul de ${reportLabel} pentru ${clientQuery}, completez datele si astept sa atasezi pozele.`
          : `Deschid si completez raportul de ${reportLabel} pentru ${clientQuery}.`,
  };
}
