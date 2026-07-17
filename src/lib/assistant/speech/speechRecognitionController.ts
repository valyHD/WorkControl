import { TranscriptAccumulator } from "./transcriptAccumulator";
import type {
  SpeechRecognitionAdapter,
  SpeechRecognitionErrorCode,
  SpeechRecognitionFactory,
  SpeechTranscriptSnapshot,
} from "./types";

type BrowserSpeechWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionAdapter;
  webkitSpeechRecognition?: new () => SpeechRecognitionAdapter;
};

export type SpeechRecognitionControllerOptions = {
  language?: string;
  createRecognition?: SpeechRecognitionFactory;
  onCommit?: (transcript: string) => void;
  onEmpty?: () => void;
  onError?: (error: SpeechRecognitionErrorCode) => void;
};

const INITIAL_SNAPSHOT: SpeechTranscriptSnapshot = {
  status: "idle",
  isHeld: false,
  finalTranscript: "",
  interimTranscript: "",
  transcript: "",
  error: null,
};

export function isBrowserSpeechRecognitionSupported() {
  if (typeof window === "undefined") return false;
  const speechWindow = window as BrowserSpeechWindow;
  return Boolean(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition);
}

export function createBrowserSpeechRecognition(): SpeechRecognitionAdapter | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as BrowserSpeechWindow;
  const Recognition = (speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition) as
    (new () => SpeechRecognitionAdapter) | undefined;
  return Recognition ? new Recognition() : null;
}

function normalizeErrorCode(error?: string): SpeechRecognitionErrorCode {
  if (
    error === "aborted" ||
    error === "audio-capture" ||
    error === "network" ||
    error === "no-speech" ||
    error === "not-allowed" ||
    error === "service-not-allowed"
  ) {
    return error;
  }
  return "unknown";
}

export class SpeechRecognitionController {
  private options: SpeechRecognitionControllerOptions;
  private recognition: SpeechRecognitionAdapter | null = null;
  private readonly transcripts = new TranscriptAccumulator();
  private readonly listeners = new Set<(snapshot: SpeechTranscriptSnapshot) => void>();
  private snapshotValue: SpeechTranscriptSnapshot = INITIAL_SNAPSHOT;
  private held = false;
  private commitRequested = false;
  private committed = false;
  private disposed = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: SpeechRecognitionControllerOptions = {}) {
    this.options = options;
  }

  updateOptions(options: SpeechRecognitionControllerOptions) {
    this.options = options;
  }

  getSnapshot() {
    return this.snapshotValue;
  }

  subscribe(listener: (snapshot: SpeechTranscriptSnapshot) => void) {
    this.listeners.add(listener);
    listener(this.snapshotValue);
    return () => {
      this.listeners.delete(listener);
    };
  }

  press() {
    if (
      this.disposed ||
      this.held ||
      ["starting", "listening", "stopping"].includes(this.snapshotValue.status)
    ) {
      return false;
    }

    this.clearRestart();
    this.transcripts.clear();
    this.held = true;
    this.commitRequested = false;
    this.committed = false;
    this.publish({ ...INITIAL_SNAPSHOT, status: "starting", isHeld: true });
    return this.startSession();
  }

  release() {
    if (this.disposed || !this.held) return false;
    this.held = false;
    this.commitRequested = true;
    this.clearRestart();
    this.publish({ ...this.snapshotValue, status: "stopping", isHeld: false });

    if (!this.recognition) {
      this.finishCommit();
      return true;
    }

    try {
      this.recognition.stop();
    } catch {
      this.recognition.abort();
      this.recognition = null;
      this.finishCommit();
    }
    return true;
  }

  cancel() {
    if (this.disposed) return;
    this.held = false;
    this.commitRequested = false;
    this.committed = true;
    this.clearRestart();
    this.recognition?.abort();
    this.recognition = null;
    this.transcripts.clear();
    this.publish(INITIAL_SNAPSHOT);
  }

  dispose() {
    if (this.disposed) return;
    this.cancel();
    this.disposed = true;
    this.listeners.clear();
  }

  private startSession() {
    const recognition = (this.options.createRecognition ?? createBrowserSpeechRecognition)();
    if (!recognition) {
      this.held = false;
      this.publish({
        ...this.snapshotValue,
        status: "unsupported",
        isHeld: false,
        error: "unsupported",
      });
      this.options.onError?.("unsupported");
      return false;
    }

    this.recognition = recognition;
    recognition.lang = this.options.language ?? "ro-RO";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;
    recognition.onstart = () => {
      if (this.recognition !== recognition || this.disposed) return;
      this.publish({ ...this.snapshotValue, status: "listening", isHeld: this.held, error: null });
    };
    recognition.onresult = (event) => {
      if (this.recognition !== recognition || this.disposed) return;
      const transcript = this.transcripts.apply(event);
      this.publish({ ...this.snapshotValue, ...transcript, isHeld: this.held });
    };
    recognition.onerror = (event) => {
      if (this.recognition !== recognition || this.disposed) return;
      const error = normalizeErrorCode(event.error);
      if (error === "aborted") return;
      this.held = false;
      this.commitRequested = false;
      this.publish({ ...this.snapshotValue, status: "error", isHeld: false, error });
      this.options.onError?.(error);
    };
    recognition.onend = () => {
      if (this.recognition !== recognition || this.disposed) return;
      this.recognition = null;

      if (this.held) {
        this.publish({ ...this.snapshotValue, status: "starting", isHeld: true });
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null;
          if (this.held && !this.disposed) this.startSession();
        }, 0);
        return;
      }

      if (this.commitRequested) {
        this.finishCommit();
      } else if (this.snapshotValue.status !== "error") {
        this.publish({ ...this.snapshotValue, status: "idle", isHeld: false });
      }
    };

    try {
      recognition.start();
      return true;
    } catch {
      this.recognition = null;
      this.held = false;
      this.publish({ ...this.snapshotValue, status: "error", isHeld: false, error: "unknown" });
      this.options.onError?.("unknown");
      return false;
    }
  }

  private finishCommit() {
    if (this.committed) return;
    this.committed = true;
    this.commitRequested = false;
    const transcript = this.transcripts.snapshot().transcript.trim();
    this.publish({ ...this.snapshotValue, status: "idle", isHeld: false });
    if (transcript) this.options.onCommit?.(transcript);
    else this.options.onEmpty?.();
  }

  private clearRestart() {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }

  private publish(snapshot: SpeechTranscriptSnapshot) {
    this.snapshotValue = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }
}
