import { describe, expect, it } from "vitest";
import { formatAssistantReportObservation } from "./assistantReportText";

describe("assistant report observation formatting", () => {
  it("capitalizes sentences and adds final punctuation", () => {
    expect(
      formatAssistantReportObservation(
        "liftul functioneaza normal. usa se inchide corect! verificarea este finalizata"
      )
    ).toBe("Liftul functioneaza normal. Usa se inchide corect! Verificarea este finalizata.");
  });

  it("removes Romanian diacritics for PDF compatibility", () => {
    expect(formatAssistantReportObservation("Șina este curată și ușa funcționează.")).toBe(
      "Sina este curata si usa functioneaza."
    );
  });

  it("normalizes spaces around punctuation without changing existing capitals", () => {
    expect(formatAssistantReportObservation("  Verificare RCA  , finalizata.  OK  ")).toBe(
      "Verificare RCA, finalizata. OK."
    );
  });
});
