export type SpeechRecognitionStatus =
  "idle" | "starting" | "listening" | "stopping" | "unsupported" | "error";

export type SpeechRecognitionErrorCode =
  | "aborted"
  | "audio-capture"
  | "network"
  | "no-speech"
  | "not-allowed"
  | "service-not-allowed"
  | "unsupported"
  | "unknown";

export type SpeechTranscriptSnapshot = {
  status: SpeechRecognitionStatus;
  isHeld: boolean;
  finalTranscript: string;
  interimTranscript: string;
  transcript: string;
  error: SpeechRecognitionErrorCode | null;
};

export type SpeechRecognitionAlternativeLike = {
  transcript: string;
};

export type SpeechRecognitionResultLike = {
  readonly length: number;
  readonly isFinal?: boolean;
  [index: number]: SpeechRecognitionAlternativeLike;
};

export type SpeechRecognitionEventLike = {
  readonly resultIndex?: number;
  readonly results: {
    readonly length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
};

export type SpeechRecognitionAdapter = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

export type SpeechRecognitionFactory = () => SpeechRecognitionAdapter | null;
