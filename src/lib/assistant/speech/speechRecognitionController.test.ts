import { describe, expect, it, vi } from "vitest";
import { SpeechRecognitionController } from "./speechRecognitionController";
import type { SpeechRecognitionAdapter, SpeechRecognitionResultLike } from "./types";

function result(transcript: string, isFinal: boolean): SpeechRecognitionResultLike {
  return Object.assign([{ transcript }], { isFinal });
}

function recognitionMock() {
  const recognition: SpeechRecognitionAdapter = {
    lang: "",
    continuous: false,
    interimResults: false,
    maxAlternatives: 0,
    onstart: null,
    onresult: null,
    onerror: null,
    onend: null,
    start: vi.fn(),
    stop: vi.fn(),
    abort: vi.fn(),
  };
  return recognition;
}

describe("SpeechRecognitionController", () => {
  it("commits once, only after a held press is released", () => {
    const recognition = recognitionMock();
    const onCommit = vi.fn();
    const controller = new SpeechRecognitionController({
      createRecognition: () => recognition,
      onCommit,
    });

    expect(controller.press()).toBe(true);
    expect(recognition.maxAlternatives).toBe(3);
    recognition.onstart?.();
    recognition.onresult?.({
      resultIndex: 0,
      results: [result("deschide mașina", true), result("mașina B 33 LGR", false)],
    });

    expect(onCommit).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({
      status: "listening",
      transcript: "deschide mașina B 33 LGR",
    });

    expect(controller.release()).toBe(true);
    expect(recognition.stop).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
    recognition.onend?.();
    recognition.onend?.();

    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith("deschide mașina B 33 LGR");
  });

  it("cancels without committing the transcript", () => {
    const recognition = recognitionMock();
    const onCommit = vi.fn();
    const controller = new SpeechRecognitionController({
      createRecognition: () => recognition,
      onCommit,
    });

    controller.press();
    recognition.onresult?.({ results: [result("șterge comanda", true)] });
    controller.cancel();

    expect(recognition.abort).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({ status: "idle", transcript: "" });
  });
});
