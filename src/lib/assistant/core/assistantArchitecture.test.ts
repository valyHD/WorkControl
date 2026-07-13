import { describe, expect, it } from "vitest";
import voiceAssistantSource from "../../../components/VoiceCommandAssistant.tsx?raw";
import formFillSource from "../runtime/assistantFormFill.ts?raw";

describe("Controlled Agent V3 architecture", () => {
  it("keeps VoiceCommandAssistant small and outside Firebase persistence", () => {
    const source = voiceAssistantSource;

    expect(source.split(/\r?\n/).length).toBeLessThanOrEqual(800);
    expect(source).not.toMatch(/firebase\/(?:firestore|database)|\b(?:addDoc|setDoc|updateDoc|deleteDoc)\b/);
    expect(source).not.toMatch(/querySelector|getElementById|dispatchEvent|CustomEvent/);
  });

  it("fills forms only through registered state adapters", () => {
    const source = formFillSource;

    expect(source).toContain("dispatchAssistantFormDraft");
    expect(source).not.toMatch(/querySelector|getElementById|dispatchEvent|CustomEvent/);
  });
});
