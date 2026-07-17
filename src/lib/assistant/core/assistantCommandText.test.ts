import { describe, expect, it } from "vitest";
import { normalizeAssistantCommandText } from "./assistantCommandText";

describe("normalizeAssistantCommandText", () => {
  it("collapses a full command repeated by speech recognition", () => {
    expect(
      normalizeAssistantCommandText(
        "genereaza raport revizie pentru Vali genereaza raport revizie pentru Vali"
      )
    ).toBe("genereaza raport revizie pentru Vali");
  });

  it("collapses a short phrase repeated many times", () => {
    expect(normalizeAssistantCommandText("ce comenzi ce comenzi ce comenzi")).toBe("ce comenzi");
  });

  it("keeps a normal command unchanged", () => {
    expect(normalizeAssistantCommandText("du-ma pe gps-ul Toyota")).toBe("du-ma pe gps-ul Toyota");
  });
});
