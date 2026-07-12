import { useCallback, useEffect, useRef, useState } from "react";

function preferredMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  return (
    ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((type) =>
      MediaRecorder.isTypeSupported(type)
    ) || ""
  );
}

export function useAssistantAudioCapture() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const resolveStopRef = useRef<((audio: Blob | null) => void) | null>(null);
  const cancelledRef = useRef(false);
  const [recording, setRecording] = useState(false);
  const supported =
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    if (!supported || recorderRef.current) return false;
    cancelledRef.current = false;
    chunksRef.current = [];
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    const mimeType = preferredMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const audio = cancelledRef.current
        ? null
        : new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || "audio/webm" });
      chunksRef.current = [];
      recorderRef.current = null;
      releaseStream();
      setRecording(false);
      resolveStopRef.current?.(audio?.size ? audio : null);
      resolveStopRef.current = null;
    };
    recorder.start(250);
    setRecording(true);
    return true;
  }, [releaseStream, supported]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return Promise.resolve<Blob | null>(null);
    return new Promise<Blob | null>((resolve) => {
      resolveStopRef.current = resolve;
      recorder.stop();
    });
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    else releaseStream();
  }, [releaseStream]);

  useEffect(() => cancel, [cancel]);
  return { supported, recording, start, stop, cancel };
}
