import type { SpeechRecognitionEventLike } from "./types";
import { normalizeAssistantCommandText } from "../core/assistantCommandText";

type TranscriptSegment = {
  text: string;
  isFinal: boolean;
};

function cleanTranscriptText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

const ASSISTANT_VOCABULARY = [
  "raport",
  "revizie",
  "interventie",
  "observatie",
  "observatia",
  "mentenanta",
  "client",
  "pontaj",
  "porneste",
  "opreste",
  "masina",
  "kilometri",
  "concediu",
  "proiect",
  "notificare",
] as const;

function normalizeForVocabulary(value: string) {
  return cleanTranscriptText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("ro-RO");
}

export function selectBestSpeechAlternative(result: SpeechRecognitionEventLike["results"][number]) {
  let bestText = cleanTranscriptText(result?.[0]?.transcript ?? "");
  let bestScore = Number(result?.[0]?.confidence ?? 0);

  for (let index = 0; index < Math.min(result?.length ?? 0, 3); index += 1) {
    const alternative = result[index];
    const text = cleanTranscriptText(alternative?.transcript ?? "");
    if (!text) continue;
    const normalized = normalizeForVocabulary(text);
    const vocabularyScore = ASSISTANT_VOCABULARY.reduce(
      (score, term) => score + (normalized.includes(term) ? 1 : 0),
      0
    );
    const confidenceScore = Number.isFinite(Number(alternative.confidence))
      ? Number(alternative.confidence) * 0.25
      : 0;
    const score = vocabularyScore + confidenceScore;
    if (score > bestScore) {
      bestText = text;
      bestScore = score;
    }
  }

  return bestText;
}

function comparisonTokens(value: string) {
  return cleanTranscriptText(value)
    .toLocaleLowerCase("ro-RO")
    .split(" ")
    .map((token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);
}

export function mergeTranscriptParts(parts: readonly string[]) {
  let merged = "";
  const seen = new Set<string>();

  for (const rawPart of parts) {
    const part = cleanTranscriptText(rawPart);
    if (!part) continue;

    const normalizedPart = comparisonTokens(part).join(" ");
    if (!normalizedPart || seen.has(normalizedPart)) continue;
    seen.add(normalizedPart);

    if (!merged) {
      merged = part;
      continue;
    }

    const mergedTokens = merged.split(/\s+/);
    const partTokens = part.split(/\s+/);
    const mergedComparison = comparisonTokens(merged);
    const partComparison = comparisonTokens(part);

    if (partComparison.join(" ").startsWith(`${mergedComparison.join(" ")} `)) {
      merged = part;
      continue;
    }

    let overlap = Math.min(mergedComparison.length, partComparison.length);
    while (overlap > 0) {
      const suffix = mergedComparison.slice(-overlap).join(" ");
      const prefix = partComparison.slice(0, overlap).join(" ");
      if (suffix === prefix) break;
      overlap -= 1;
    }

    if (overlap === partComparison.length) continue;
    merged = [...mergedTokens, ...partTokens.slice(overlap)].join(" ");
  }

  return normalizeAssistantCommandText(merged);
}

export class TranscriptAccumulator {
  private readonly segments = new Map<number, TranscriptSegment>();

  clear() {
    this.segments.clear();
  }

  apply(event: SpeechRecognitionEventLike) {
    const startIndex = Math.max(0, event.resultIndex ?? 0);

    for (let index = startIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const text = selectBestSpeechAlternative(result);
      if (text) {
        this.segments.set(index, { text, isFinal: result.isFinal === true });
      } else {
        this.segments.delete(index);
      }
    }

    for (const index of this.segments.keys()) {
      if (index >= event.results.length) this.segments.delete(index);
    }

    return this.snapshot();
  }

  snapshot() {
    const ordered = [...this.segments.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, segment]) => segment);
    const finalTranscript = mergeTranscriptParts(
      ordered.filter((segment) => segment.isFinal).map((segment) => segment.text)
    );
    const interimTranscript = mergeTranscriptParts(
      ordered.filter((segment) => !segment.isFinal).map((segment) => segment.text)
    );

    return {
      finalTranscript,
      interimTranscript,
      transcript: mergeTranscriptParts(ordered.map((segment) => segment.text)),
    };
  }
}
