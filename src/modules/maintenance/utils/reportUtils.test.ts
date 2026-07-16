import { describe, expect, it } from "vitest";
import {
  INTERVENTION_REPORT_STANDARD_TEXT,
  reviewStandardText,
} from "./reportUtils";

describe("maintenance report text", () => {
  it("uses the approved intervention wording without the old completion claim", () => {
    expect(INTERVENTION_REPORT_STANDARD_TEXT).toBe(
      "S-a efectuat interventia conform sesizarii clientului. Instalatia a fost verificata si s-au constatat urmatoarele:"
    );
    expect(INTERVENTION_REPORT_STANDARD_TEXT).not.toContain(
      "readusa in stare de functionare in siguranta"
    );
  });

  it("keeps the existing revision wording selection", () => {
    expect(reviewStandardText("210869", "R2")).toContain("P.T. ISCIR - R2");
    expect(reviewStandardText("310869", "R1")).toContain("P.T. ISCIR - R1");
  });
});
