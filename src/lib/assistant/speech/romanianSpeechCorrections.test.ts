import { describe, expect, it } from "vitest";
import {
  correctRomanianDate,
  correctRomanianEmail,
  correctRomanianKilometers,
  correctRomanianLiftNumber,
  correctRomanianPhone,
  correctRomanianPlate,
  parseRomanianSpokenNumber,
} from "./romanianSpeechCorrections";

describe("Romanian speech corrections", () => {
  it("parses Romanian spoken numbers and mileage", () => {
    expect(parseRomanianSpokenNumber("șase mii șase sute șaisprezece")).toBe(6616);
    expect(correctRomanianKilometers("6.616 kilometri")).toBe(6616);
  });

  it("formats spoken vehicle plates and lift numbers", () => {
    expect(correctRomanianPlate("be treizeci și trei el ge er")).toBe("B 33 LGR");
    expect(correctRomanianLiftNumber("lift a doisprezece")).toBe("A12");
  });

  it("normalizes dates without guessing invalid calendar values", () => {
    expect(correctRomanianDate("douăzeci și patru august două mii douăzeci și șase")).toBe(
      "2026-08-24"
    );
    expect(correctRomanianDate("31.02.2026")).toBeNull();
  });

  it("normalizes spoken email and phone separators", () => {
    expect(correctRomanianEmail("ionut punct popescu arond gmail punct com")).toBe(
      "ionut.popescu@gmail.com"
    );
    expect(correctRomanianPhone("zero șapte doi doi unu doi trei patru cinci șase")).toBe(
      "0722123456"
    );
  });
});
