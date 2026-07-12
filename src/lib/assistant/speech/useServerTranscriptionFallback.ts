import { useCallback, useEffect, useRef, useState } from "react";

export type ServerTranscriptionRequest = {
  audio: Blob;
  language: string;
  signal: AbortSignal;
};

export type ServerTranscriptionFallbackOptions = {
  enabled: boolean;
  allowAudioUpload: boolean;
  transcribe: (request: ServerTranscriptionRequest) => Promise<string>;
  language?: string;
};

export type ServerTranscriptionFallbackStatus =
  "idle" | "blocked" | "transcribing" | "success" | "error";

export function useServerTranscriptionFallback(options: ServerTranscriptionFallbackOptions) {
  const abortRef = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<ServerTranscriptionFallbackStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("idle");
  }, []);

  const reset = useCallback(() => {
    cancel();
    setTranscript("");
    setError(null);
  }, [cancel]);

  const transcribeAudio = useCallback(
    async (audio: Blob) => {
      setError(null);

      if (!options.enabled || options.allowAudioUpload !== true) {
        setStatus("blocked");
        setError("Este necesar acordul explicit pentru trimiterea audio către server.");
        return null;
      }

      if (audio.size === 0) {
        setStatus("error");
        setError("Înregistrarea audio este goală.");
        return null;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus("transcribing");

      try {
        const nextTranscript = (
          await options.transcribe({
            audio,
            language: options.language ?? "ro-RO",
            signal: controller.signal,
          })
        ).trim();
        if (controller.signal.aborted) return null;
        setTranscript(nextTranscript);
        setStatus("success");
        return nextTranscript;
      } catch (caughtError) {
        if (controller.signal.aborted) return null;
        const message =
          caughtError instanceof Error ? caughtError.message : "Transcrierea nu a reușit.";
        setError(message);
        setStatus("error");
        return null;
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [options]
  );

  useEffect(() => () => abortRef.current?.abort(), []);

  return { status, transcript, error, transcribeAudio, cancel, reset };
}
