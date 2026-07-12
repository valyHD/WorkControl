const MAX_ASSISTANT_AUDIO_BYTES = 3 * 1024 * 1024;

const ALLOWED_AUDIO_TYPES = new Map([
  ["audio/webm", "webm"],
  ["audio/ogg", "ogg"],
  ["audio/wav", "wav"],
  ["audio/x-wav", "wav"],
  ["audio/mpeg", "mp3"],
  ["audio/mp4", "m4a"],
  ["audio/x-m4a", "m4a"],
]);

function normalizeMimeType(value) {
  return String(value || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
}

function decodeAssistantAudioPayload(data) {
  const value = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  if (value.consent !== true) throw new TypeError("consent_required");

  const mimeType = normalizeMimeType(value.mimeType);
  const extension = ALLOWED_AUDIO_TYPES.get(mimeType);
  if (!extension) throw new TypeError("unsupported_audio_type");

  const audioBase64 = typeof value.audioBase64 === "string" ? value.audioBase64.trim() : "";
  if (!audioBase64 || audioBase64.length > Math.ceil((MAX_ASSISTANT_AUDIO_BYTES * 4) / 3) + 8) {
    throw new TypeError("invalid_audio_size");
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(audioBase64)) throw new TypeError("invalid_audio_encoding");

  const bytes = Buffer.from(audioBase64, "base64");
  if (!bytes.length || bytes.length > MAX_ASSISTANT_AUDIO_BYTES) {
    throw new TypeError("invalid_audio_size");
  }

  const language =
    String(value.language || "ro")
      .trim()
      .toLowerCase() === "ro"
      ? "ro"
      : "ro";
  return { bytes, mimeType, extension, language };
}

async function requestAssistantTranscription({
  bytes,
  mimeType,
  extension,
  language,
  apiKey,
  model,
}) {
  const body = new FormData();
  body.append("file", new Blob([bytes], { type: mimeType }), `assistant-command.${extension}`);
  body.append("model", model || "gpt-4o-mini-transcribe");
  body.append("language", language || "ro");
  body.append("response_format", "json");
  body.append(
    "prompt",
    "Comanda vocala in limba romana pentru aplicatia WorkControl. Pastreaza corect numerele de inmatriculare, kilometrii, numele proiectelor si datele calendaristice."
  );

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
  });
  const responseText = await response.text();
  if (!response.ok) {
    const error = new Error("transcription_failed");
    error.status = response.status;
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new Error("invalid_transcription_response");
  }
  const transcript =
    typeof parsed?.text === "string" ? parsed.text.replace(/\s+/g, " ").trim() : "";
  if (!transcript) throw new Error("empty_transcription");
  return transcript.slice(0, 600);
}

module.exports = {
  ALLOWED_AUDIO_TYPES,
  MAX_ASSISTANT_AUDIO_BYTES,
  decodeAssistantAudioPayload,
  normalizeMimeType,
  requestAssistantTranscription,
};
