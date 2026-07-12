const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MAX_ASSISTANT_AUDIO_BYTES,
  decodeAssistantAudioPayload,
  normalizeMimeType,
} = require("./assistantTranscription");

test("assistant transcription requires explicit consent and an allowed audio type", () => {
  assert.throws(
    () =>
      decodeAssistantAudioPayload({ consent: false, mimeType: "audio/webm", audioBase64: "YQ==" }),
    /consent_required/
  );
  assert.throws(
    () =>
      decodeAssistantAudioPayload({ consent: true, mimeType: "text/plain", audioBase64: "YQ==" }),
    /unsupported_audio_type/
  );
});

test("assistant transcription decodes a bounded audio payload", () => {
  const result = decodeAssistantAudioPayload({
    consent: true,
    mimeType: "audio/webm;codecs=opus",
    audioBase64: Buffer.from("voice").toString("base64"),
    language: "ro",
  });
  assert.equal(result.bytes.toString(), "voice");
  assert.equal(result.mimeType, "audio/webm");
  assert.equal(result.extension, "webm");
  assert.equal(normalizeMimeType(" audio/ogg; codecs=opus "), "audio/ogg");
});

test("assistant transcription rejects oversized and malformed payloads", () => {
  assert.throws(
    () =>
      decodeAssistantAudioPayload({
        consent: true,
        mimeType: "audio/webm",
        audioBase64: "not base64!",
      }),
    /invalid_audio_encoding/
  );
  assert.throws(
    () =>
      decodeAssistantAudioPayload({
        consent: true,
        mimeType: "audio/webm",
        audioBase64: Buffer.alloc(MAX_ASSISTANT_AUDIO_BYTES + 1).toString("base64"),
      }),
    /invalid_audio_size/
  );
});
