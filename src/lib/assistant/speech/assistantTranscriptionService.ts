import { httpsCallable } from "firebase/functions";
import { functions } from "../../firebase/firebase";

type TranscriptionResponse = { transcript?: string };

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error || new Error("Nu am putut citi inregistrarea audio."));
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      resolve(value.includes(",") ? value.slice(value.indexOf(",") + 1) : value);
    };
    reader.readAsDataURL(blob);
  });
}

export async function transcribeAssistantAudio(audio: Blob, signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Transcriere anulata.", "AbortError");
  if (!audio.size) throw new Error("Inregistrarea audio este goala.");

  const transcribe = httpsCallable<
    { audioBase64: string; mimeType: string; language: string; consent: true },
    TranscriptionResponse
  >(functions, "transcribeAssistantAudio");
  const result = await transcribe({
    audioBase64: await blobToBase64(audio),
    mimeType: audio.type || "audio/webm",
    language: "ro",
    consent: true,
  });
  if (signal?.aborted) throw new DOMException("Transcriere anulata.", "AbortError");
  const transcript = String(result.data?.transcript || "").trim();
  if (!transcript) throw new Error("Serverul nu a returnat un transcript.");
  return transcript;
}
