import { describe, expect, it } from "vitest";
import { TranscriptAccumulator, mergeTranscriptParts } from "./transcriptAccumulator";
import type { SpeechRecognitionEventLike, SpeechRecognitionResultLike } from "./types";

function result(transcript: string, isFinal: boolean): SpeechRecognitionResultLike {
  return Object.assign([{ transcript }], { isFinal });
}

function event(
  results: SpeechRecognitionResultLike[],
  resultIndex = 0
): SpeechRecognitionEventLike {
  return { results, resultIndex };
}

describe("TranscriptAccumulator", () => {
  it("deduplicates repeated and overlapping transcript fragments", () => {
    expect(mergeTranscriptParts(["deschide mașina", "mașina B 33 LGR", "B 33 LGR"])).toBe(
      "deschide mașina B 33 LGR"
    );
  });

  it("replaces interim results with final results at the same index", () => {
    const accumulator = new TranscriptAccumulator();
    expect(accumulator.apply(event([result("schimbă kilometrii", false)]))).toMatchObject({
      finalTranscript: "",
      interimTranscript: "schimbă kilometrii",
    });

    expect(
      accumulator.apply(event([result("schimbă kilometrii", true), result("la șase mii", false)]))
    ).toEqual({
      finalTranscript: "schimbă kilometrii",
      interimTranscript: "la șase mii",
      transcript: "schimbă kilometrii la șase mii",
    });
  });
});
