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

  it("canonicalizes a normal navigation command", () => {
    expect(normalizeAssistantCommandText("du-ma pe gps-ul Toyota")).toBe("deschide gps-ul Toyota");
  });

  it("removes a repeated STT prefix while keeping the rest of the command", () => {
    expect(
      normalizeAssistantCommandText("genereaza raport genereaza raport revizie pentru Vali")
    ).toBe("genereaza raport revizie pentru Vali");
  });

  it("does not collapse repeated numeric identifiers", () => {
    expect(normalizeAssistantCommandText("cauta liftul 210 210")).toBe("cauta liftul 210 210");
  });

  it("understands real Romanian diacritics without corrupting the command", () => {
    expect(normalizeAssistantCommandText("du-m\u0103 pe ma\u0219ini")).toBe("deschide masini");
    expect(normalizeAssistantCommandText("ponteaz\u0103-m\u0103 pe Mentenan\u021b\u0103")).toBe(
      "porneste pontajul pe Mentenanta"
    );
  });

  it.each([
    ["duma la concedii", "deschide concedii"],
    ["du-te la dashboard", "deschide dashboard"],
    ["baga-ma pe pagina cu scule", "deschide pagina cu scule"],
    ["ia vezi pe proiecte", "deschide proiecte"],
    ["uita-te la notificari", "deschide notificari"],
    ["hai pe masini", "deschide masini"],
    ["unde gasesc facturile", "deschide facturile"],
    ["vreau la bonuri", "deschide bonuri"],
    ["da-i drumu la pontaju pe proiectu Service 2", "porneste pontajul pe proiectul Service 2"],
    ["ponteaza-ma pe Hotel Balada", "porneste pontajul pe Hotel Balada"],
    ["incep munca pe Service Lifturi", "porneste pontajul pe Service Lifturi"],
    ["gata pe azi", "opreste pontajul"],
    ["am terminat pe azi", "opreste pontajul"],
    ["inchide ziua", "opreste pontajul"],
    ["raportu de interventie pentru clientu Vali", "raportul de interventie pentru clientul Vali"],
    ["genereaza revize petru oltenita c1", "genereaza revizie pentru oltenita c1"],
    ["genereala pentru oltenita bloc c1", "genereaza pentru oltenita bloc c1"],
    ["te rog frumos sa duma la masni", "deschide masini"],
    ["poti sa ma duci pe notificrile", "deschide notificarile"],
    ["as vrea sa vad cheltuelile", "deschide cheltuieli"],
    ["vreau sa ma uit la masni", "deschide masini"],
    ["poti sa imi deschizi pontaju meu", "deschide pontajul meu"],
    ["modifica-mi revisie la Toyota", "modifica revizie la Toyota"],
    ["seteaza-mi tema siteului pe mov", "seteaza tema siteului pe mov"],
    ["aratami kilometriii de la masinamea", "deschide kilometri de la masina mea"],
    ["du-ma pe gpesu Toyota", "deschide gps-ul Toyota"],
    ["du-ma pe gpesurile toate", "deschide gps-urile toate"],
    ["fa-mi un raport de revizie pentru Vali", "genereaza raport de revizie pentru Vali"],
    ["pune-mi functia electrician", "pune functia electrician"],
    ["vreau ca departamentul meu sa fie Service", "seteaza departamentul Service"],
    [
      "da drumul la sunet pentru regula Pontaj start",
      "activeaza sunetul pentru regula Pontaj start",
    ],
    ["deschide setariile mele", "deschide setarile mele"],
    ["fa masina asta indisponibila", "seteaza status indisponibila"],
    ["pai uite modifca kilometri la 7200", "modifica kilometri la 7200"],
    ["deci schima departametu in Service", "schimba departamentul in Service"],
    ["baga un raport interventi pt Vali", "genereaza raport interventie pentru Vali"],
    ["muta-l la Razvan", "muta la Razvan"],
    ["fa-l defect", "seteaza status defect"],
    ["schimba si la ala", "schimba aici"],
  ])("normalizes colloquial Romanian without changing the payload: %s", (input, expected) => {
    expect(normalizeAssistantCommandText(input)).toBe(expected);
  });

  it("keeps the original wording available for audit", () => {
    expect(cleanAssistantCommandTranscript("duma la concedii")).toBe("duma la concedii");
  });
});
