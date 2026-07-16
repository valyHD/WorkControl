import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../providers/AuthProvider";
import { interpretAssistantCommand } from "../lib/assistant/assistantCommandService";
import {
  AssistantV3Orchestrator,
  ASSISTANT_V3_SAFE_CONFIDENCE,
  buildAssistantExecutionSteps,
  buildAssistantV3PageContext,
  createAssistantConversationMemory,
  createAssistantTelemetry,
  type AssistantOrchestratorResult,
} from "../lib/assistant/core";
import type { AssistantV3Contract } from "../lib/assistant/core/assistantV3Types";
import {
  createBrowserAssistantAdapterRuntime,
  getAssistantV3ToolRegistry,
} from "../lib/assistant/adapters";
import { resolveAssistantTimesheetLocation } from "../lib/assistant/adapters/timesheetAdapter";
import { scheduleAssistantNextStepHighlight } from "../lib/assistant/runtime/assistantButtonHighlighter";
import {
  transcribeAssistantAudio,
  useAssistantAudioCapture,
  useServerTranscriptionFallback,
  useSpeechRecognitionController,
} from "../lib/assistant/speech";
import {
  AssistantPanel,
  ChoiceCard,
  ConfirmationCard,
  DebugPanel,
  ExecutionPlan,
  type AssistantChoice,
  type AssistantConfirmationRow,
  type AssistantRisk,
  type AssistantUiState,
} from "../lib/assistant/ui";

type AssistantHistoryItem = {
  id: string;
  transcript: string;
  message: string;
  status: "success" | "failed" | "cancelled" | "pending";
};

type PendingExecution = {
  command: string;
  contract: AssistantV3Contract;
  outcome: AssistantOrchestratorResult;
};

const ORDINALS = [
  ["prima", "primul", "unu", "1"],
  ["a doua", "al doilea", "doi", "2"],
  ["a treia", "al treilea", "trei", "3"],
  ["a patra", "al patrulea", "patru", "4"],
  ["a cincea", "al cincilea", "cinci", "5"],
] as const;

function normalizeChoiceText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findChoice(command: string, choices: AssistantChoice[]) {
  const normalized = normalizeChoiceText(command);
  const ordinalIndex = ORDINALS.findIndex((terms) =>
    terms.some((term) => normalized === term || normalized.includes(` ${term}`))
  );
  if (ordinalIndex >= 0) return choices[ordinalIndex] || null;
  return (
    choices.find((choice) => {
      const label = normalizeChoiceText(choice.label);
      return label && (normalized.includes(label) || label.includes(normalized));
    }) || null
  );
}

function valueLabel(value: unknown) {
  if (value === undefined || value === null || value === "") return "-";
  if (typeof value === "boolean") return value ? "Da" : "Nu";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function outcomeRisk(
  outcome: AssistantOrchestratorResult,
  registry: ReturnType<typeof getAssistantV3ToolRegistry>
): AssistantRisk {
  const risks =
    outcome.contract?.toolCalls.map((call) => registry.get(call.id)?.risk || "low") || [];
  if (risks.includes("high")) return "high";
  if (risks.includes("medium")) return "medium";
  return "low";
}

function outcomeRows(outcome: AssistantOrchestratorResult): AssistantConfirmationRow[] {
  const reportCall = outcome.contract?.toolCalls.find((call) =>
    call.id.startsWith("maintenance.report.")
  );
  const reportFields =
    reportCall?.input.fields &&
    typeof reportCall.input.fields === "object" &&
    !Array.isArray(reportCall.input.fields)
      ? (reportCall.input.fields as Record<string, unknown>)
      : null;
  if (reportFields) {
    return [
      {
        id: "maintenance-report-client",
        label: "Client",
        oldValue: "",
        newValue: valueLabel(reportFields.clientQuery),
      },
      {
        id: "maintenance-report-type",
        label: "Tip raport",
        oldValue: "",
        newValue: reportFields.reportType === "interventie" ? "Interventie" : "Revizie",
      },
      ...(reportFields.observations
        ? [
            {
              id: "maintenance-report-observations",
              label: "Observatii",
              oldValue: "",
              newValue: valueLabel(reportFields.observations),
            },
          ]
        : []),
    ];
  }
  if (outcome.changes?.length) {
    return outcome.changes.map((change) => ({
      id: change.id,
      label: change.label,
      oldValue: valueLabel(change.oldValue),
      newValue: valueLabel(change.newValue),
    }));
  }
  return outcome.previews.map((preview, index) => ({
    id: `preview-${index}`,
    label: `Actiunea ${index + 1}`,
    oldValue: "Neexecutata",
    newValue: preview,
  }));
}

export default function VoiceCommandAssistant() {
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const memoryRef = useRef(createAssistantConversationMemory());
  const choiceCommandRef = useRef("");
  const prepareRef = useRef<(command: string, source?: "browser" | "server" | "manual") => void>(
    () => undefined
  );
  const lastAudioPromiseRef = useRef<Promise<Blob | null> | null>(null);
  const speechFailedRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [uiState, setUiState] = useState<AssistantUiState>("idle");
  const [transcript, setTranscript] = useState("");
  const [manualCommand, setManualCommand] = useState("");
  const [message, setMessage] = useState("Spune-mi ce vrei sa fac in WorkControl.");
  const [pending, setPending] = useState<PendingExecution | null>(null);
  const [lastOutcome, setLastOutcome] = useState<AssistantOrchestratorResult | null>(null);
  const [choices, setChoices] = useState<AssistantChoice[]>([]);
  const [history, setHistory] = useState<AssistantHistoryItem[]>([]);
  const [serverAudioConsent, setServerAudioConsent] = useState(false);

  const registry = useMemo(() => getAssistantV3ToolRegistry(), []);
  const orchestrator = useMemo(
    () =>
      new AssistantV3Orchestrator(
        (command, context) => interpretAssistantCommand(command, context),
        registry
      ),
    [registry]
  );

  const actor = useMemo(
    () =>
      user?.uid
        ? {
            uid: user.uid,
            displayName: user.displayName,
            email: user.email,
            themeKey: user.themeKey ?? null,
            role: role || "angajat",
          }
        : null,
    [role, user]
  );

  const telemetry = useMemo(
    () =>
      actor
        ? createAssistantTelemetry({
            userId: actor.uid,
            userName: actor.displayName || actor.email || "Utilizator",
          })
        : undefined,
    [actor]
  );

  const runtime = useMemo(
    () =>
      createBrowserAssistantAdapterRuntime({
        navigate,
        getTimesheetLocation: resolveAssistantTimesheetLocation,
        audit: telemetry,
      }),
    [navigate, telemetry]
  );

  const audioCapture = useAssistantAudioCapture();
  const serverTranscription = useServerTranscriptionFallback({
    enabled: audioCapture.supported,
    allowAudioUpload: serverAudioConsent,
    language: "ro-RO",
    transcribe: ({ audio, signal }) => transcribeAssistantAudio(audio, signal),
  });

  const addHistory = useCallback((item: Omit<AssistantHistoryItem, "id">) => {
    setHistory((current) =>
      [
        { ...item, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` },
        ...current,
      ].slice(0, 5)
    );
  }, []);

  const pageContext = useCallback(
    () =>
      buildAssistantV3PageContext({
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
        role: role || "angajat",
        memory: memoryRef.current.getSnapshot(),
      }),
    [location.hash, location.pathname, location.search, role]
  );

  const applyOutcome = useCallback(
    (command: string, outcome: AssistantOrchestratorResult) => {
      setLastOutcome(outcome);
      setMessage(outcome.message);
      if (outcome.status === "confirmation_required" && outcome.contract) {
        setPending({ command, contract: outcome.contract, outcome });
        setChoices([]);
        setUiState("confirming");
        addHistory({ transcript: command, message: outcome.message, status: "pending" });
        return;
      }
      if (outcome.status === "needs_clarification") {
        const nextChoices = (outcome.choices || []).map((choice) => ({
          id: choice.id,
          label: choice.label,
          description: choice.description,
        }));
        choiceCommandRef.current = nextChoices.length ? command : "";
        setChoices(nextChoices);
        setPending(null);
        setUiState("idle");
        addHistory({ transcript: command, message: outcome.message, status: "pending" });
        return;
      }
      if (outcome.status === "executed") {
        outcome.results.forEach((result) => {
          if (result.entityId && outcome.contract?.entityReferences[0]) {
            const reference = outcome.contract.entityReferences[0];
            memoryRef.current.rememberEntity({
              entityType: reference.type,
              entityId: result.entityId,
              label: reference.query || result.entityId,
            });
          }
        });
        setPending(null);
        setChoices([]);
        setUiState("idle");
        addHistory({ transcript: command, message: outcome.message, status: "success" });
        if (
          outcome.contract?.toolCalls.some(
            (call) => call.id.startsWith("navigation.") || call.id.startsWith("maintenance.report.")
          )
        )
          setOpen(false);
        return;
      }
      setPending(null);
      setChoices([]);
      setUiState("error");
      addHistory({ transcript: command, message: outcome.message, status: "failed" });
    },
    [addHistory]
  );

  const prepareCommand = useCallback(
    async (rawCommand: string, source: "browser" | "server" | "manual" = "browser") => {
      const command = rawCommand.replace(/\s+/g, " ").trim();
      if (!command) {
        setMessage("Scrie sau dicteaza o comanda.");
        return;
      }

      const selected = choices.length ? findChoice(command, choices) : null;
      if (selected && choiceCommandRef.current) {
        const original = choiceCommandRef.current;
        choiceCommandRef.current = "";
        setChoices([]);
        await prepareRef.current(`${original}. Aleg ${selected.label}.`);
        return;
      }

      setOpen(true);
      setTranscript(command);
      setPending(null);
      setChoices([]);
      setUiState("thinking");
      setMessage("Inteleg comanda si construiesc planul...");
      memoryRef.current.rememberCommand(command);
      try {
        const outcome = await orchestrator.run({
          command,
          pageContext: pageContext(),
          actor,
          runtime,
        });

        if (
          source === "browser" &&
          serverAudioConsent &&
          outcome.status === "needs_clarification" &&
          (outcome.contract?.confidence ?? 0) < ASSISTANT_V3_SAFE_CONFIDENCE
        ) {
          const audio = await lastAudioPromiseRef.current;
          if (audio) {
            setMessage("Verific transcrierea cu fallback-ul audio acceptat...");
            const serverTranscript = await serverTranscription.transcribeAudio(audio);
            if (
              serverTranscript &&
              normalizeChoiceText(serverTranscript) !== normalizeChoiceText(command)
            ) {
              await prepareRef.current(serverTranscript, "server");
              return;
            }
          }
        }
        applyOutcome(command, outcome);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Nu am putut interpreta comanda.";
        setMessage(errorMessage);
        setUiState("error");
        addHistory({ transcript: command, message: errorMessage, status: "failed" });
      }
    },
    [
      actor,
      addHistory,
      applyOutcome,
      choices,
      orchestrator,
      pageContext,
      runtime,
      serverAudioConsent,
      serverTranscription,
    ]
  );

  useEffect(() => {
    prepareRef.current = (command, source) => {
      void prepareCommand(command, source);
    };
  }, [prepareCommand]);

  const speech = useSpeechRecognitionController({
    language: "ro-RO",
    onCommit: (command) => prepareRef.current(command),
    onEmpty: () => {
      setUiState("idle");
      setMessage("Nu am auzit comanda. Tine apasat si vorbeste aproape de microfon.");
    },
    onError: (error) => {
      speechFailedRef.current = true;
      setOpen(true);
      setUiState("error");
      setMessage(
        error === "not-allowed" || error === "service-not-allowed"
          ? "Permite accesul la microfon din setarile browserului."
          : "Microfonul nu a putut transcrie comanda. Poti scrie comanda mai jos."
      );
    },
  });

  useEffect(() => {
    memoryRef.current.syncPath(location.pathname);
  }, [location.pathname]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.has("assistant") || params.has("assistantField")) {
      scheduleAssistantNextStepHighlight(location.pathname, location.search, 250);
    }
  }, [location.pathname, location.search]);

  const confirmPending = useCallback(async () => {
    if (!pending) return;
    setUiState("executing");
    setMessage("Execut planul confirmat...");
    try {
      const outcome = await orchestrator.run({
        command: pending.command,
        contract: pending.contract,
        pageContext: pageContext(),
        actor,
        runtime,
        confirmedToolCallIds: pending.contract.toolCalls.map((call) => call.id),
      });
      applyOutcome(pending.command, outcome);
      if (outcome.status === "executed") setOpen(false);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Executia a esuat.";
      setUiState("error");
      setMessage(errorMessage);
      addHistory({ transcript: pending.command, message: errorMessage, status: "failed" });
    }
  }, [actor, addHistory, applyOutcome, orchestrator, pageContext, pending, runtime]);

  const cancelPending = useCallback(() => {
    if (pending)
      addHistory({ transcript: pending.command, message: "Comanda anulata.", status: "cancelled" });
    setPending(null);
    setUiState("idle");
    setMessage("Am anulat comanda.");
  }, [addHistory, pending]);

  const startListening = useCallback(() => {
    setOpen(true);
    speechFailedRef.current = false;
    setUiState("listening");
    setMessage("Ascult cat timp tii apasat.");
    if (serverAudioConsent && audioCapture.supported) {
      void audioCapture.start().catch(() => {
        setUiState("error");
        setMessage("Browserul nu a permis inregistrarea pentru fallback.");
      });
    }
    if (speech.status !== "unsupported") {
      speech.press();
    } else if (!serverAudioConsent) {
      setUiState("error");
      setMessage("Web Speech nu este disponibil. Activeaza acordul pentru fallback-ul audio.");
    }
  }, [audioCapture, serverAudioConsent, speech]);

  const finishListening = useCallback(() => {
    const audioPromise =
      serverAudioConsent && audioCapture.supported
        ? audioCapture.stop()
        : Promise.resolve<Blob | null>(null);
    lastAudioPromiseRef.current = audioPromise;

    if (speech.status !== "unsupported") speech.release();
    if (speech.status === "unsupported" || speechFailedRef.current) {
      setUiState("thinking");
      setMessage("Transcriu comanda prin fallback-ul acceptat...");
      void audioPromise
        .then((audio) => (audio ? serverTranscription.transcribeAudio(audio) : null))
        .then((serverTranscript) => {
          if (serverTranscript) prepareRef.current(serverTranscript, "server");
          else {
            setUiState("error");
            setMessage("Nu am putut transcrie inregistrarea.");
          }
        });
    }
  }, [audioCapture, serverAudioConsent, serverTranscription, speech]);

  const close = useCallback(() => {
    speech.cancel();
    audioCapture.cancel();
    serverTranscription.cancel();
    setOpen(false);
    setUiState("idle");
  }, [audioCapture, serverTranscription, speech]);

  const planSteps = lastOutcome?.contract
    ? buildAssistantExecutionSteps(lastOutcome.contract, uiState === "executing", registry)
    : [];
  const pendingReportCall = pending?.contract.toolCalls.find((call) =>
    call.id.startsWith("maintenance.report.")
  );
  const pendingReportSend = pendingReportCall?.id === "maintenance.report.send";
  const debugEnabled = new URLSearchParams(location.search).get("assistantDebug") === "1";
  const debugEntries = lastOutcome
    ? [
        { id: "status", label: "Status", value: lastOutcome.status },
        { id: "version", label: "Contract", value: lastOutcome.contract?.version || "invalid" },
        { id: "intent", label: "Intent", value: lastOutcome.contract?.intent || "-" },
        { id: "tools", label: "Tool calls", value: lastOutcome.contract?.toolCalls || [] },
        { id: "confidence", label: "Confidence", value: lastOutcome.contract?.confidence ?? 0 },
        {
          id: "missing",
          label: "Informatii lipsa",
          value: lastOutcome.contract?.missingInformation || [],
        },
        { id: "errors", label: "Erori", value: lastOutcome.errors || [] },
      ]
    : [];

  return (
    <div className={`voice-assistant ${open ? "voice-assistant--open" : ""}`}>
      {!open ? (
        <button
          type="button"
          className="voice-assistant__fab"
          aria-label="Deschide asistentul vocal"
          onClick={() => setOpen(true)}
        >
          <Bot size={22} />
        </button>
      ) : null}

      <AssistantPanel
        open={open}
        state={uiState}
        statusText={message}
        transcript={transcript || speech.finalTranscript}
        interimTranscript={uiState === "listening" ? speech.interimTranscript : ""}
        onClose={close}
        onListenStart={startListening}
        onListenEnd={finishListening}
        onListenCancel={() => {
          speech.cancel();
          audioCapture.cancel();
        }}
        speechSupported={
          speech.status !== "unsupported" || (serverAudioConsent && audioCapture.supported)
        }
        manualValue={manualCommand}
        manualPlaceholder="Sau scrie comanda..."
        onManualChange={setManualCommand}
        onManualSubmit={() => {
          void prepareCommand(manualCommand, "manual");
          setManualCommand("");
        }}
        serverFallbackAvailable={audioCapture.supported}
        serverFallbackConsent={serverAudioConsent}
        onServerFallbackConsentChange={setServerAudioConsent}
        showComposer={!pending}
      >
        {pending ? (
          <ConfirmationCard
            title={pendingReportSend ? "Confirma trimiterea" : undefined}
            summary={
              pendingReportCall
                ? undefined
                : pending.outcome.previews.join(" ") || pending.outcome.message
            }
            rows={outcomeRows(pending.outcome)}
            risk={outcomeRisk(pending.outcome, registry)}
            confidence={pendingReportCall ? undefined : pending.contract.confidence}
            reason={
              pending.contract.confirmationRequired && !pendingReportCall
                ? "Actiunea modifica date si necesita acord explicit."
                : undefined
            }
            confirmLabel={pendingReportSend ? "Genereaza si trimite" : undefined}
            compact={Boolean(pendingReportCall)}
            busy={uiState === "executing"}
            onConfirm={() => void confirmPending()}
            onCancel={cancelPending}
          />
        ) : null}
        {choices.length ? (
          <ChoiceCard
            description={message}
            choices={choices}
            onSelect={(choice) => {
              const original = choiceCommandRef.current || transcript;
              choiceCommandRef.current = "";
              setChoices([]);
              void prepareCommand(`${original}. Aleg ${choice.label}.`);
            }}
          />
        ) : null}
        {!pending && !choices.length && planSteps.length > 1 ? (
          <ExecutionPlan steps={planSteps} />
        ) : null}
        {!pending && !choices.length && role === "admin" && debugEnabled && debugEntries.length ? (
          <DebugPanel entries={debugEntries} />
        ) : null}
        {!pending && !choices.length && history.length ? (
          <section aria-label="Ultimele comenzi AI">
            {history.slice(0, 3).map((item) => (
              <p key={item.id}>
                <strong>{item.status}</strong> {item.message}
              </p>
            ))}
          </section>
        ) : null}
      </AssistantPanel>
    </div>
  );
}
