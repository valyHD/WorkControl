import { describe, expect, it } from "vitest";
import {
  TranscriptAccumulator,
  mergeTranscriptParts,
  selectBestSpeechAlternative,
} from "./transcriptAccumulator";
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

  it("collapses a complete command repeated inside one browser result", () => {
    expect(
      mergeTranscriptParts([
        "genereaza raport revizie pentru Vali genereaza raport revizie pentru Vali",
      ])
    ).toBe("genereaza raport revizie pentru Vali");
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

  it("chooses the alternative that contains WorkControl command vocabulary", () => {
    const alternatives = Object.assign(
      [
        { transcript: "fa un aport in tre ventie", confidence: 0.82 },
        { transcript: "fa un raport interventie", confidence: 0.7 },
      ],
      { isFinal: true }
    );

    expect(selectBestSpeechAlternative(alternatives)).toBe("fa un raport interventie");
  });
});
