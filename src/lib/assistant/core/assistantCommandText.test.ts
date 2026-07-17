import { describe, expect, it } from "vitest";
import {
  cleanAssistantCommandTranscript,
  normalizeAssistantCommandText,
} from "./assistantCommandText";

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

  it.each([
    ["duma la concedii", "deschide concedii"],
    ["baga-ma pe pagina cu scule", "deschide pagina cu scule"],
    ["vreau la bonuri", "deschide bonuri"],
    ["da-i drumu la pontaju pe proiectu Service 2", "porneste pontajul pe proiectul Service 2"],
    ["gata pe azi", "opreste pontajul"],
    ["raportu de interventie pentru clientu Vali", "raportul de interventie pentru clientul Vali"],
  ])("normalizes colloquial Romanian without changing the payload: %s", (input, expected) => {
    expect(normalizeAssistantCommandText(input)).toBe(expected);
  });

  it("keeps the original wording available for audit", () => {
    expect(cleanAssistantCommandTranscript("duma la concedii")).toBe("duma la concedii");
  });
});
