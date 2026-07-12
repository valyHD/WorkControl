import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useServerTranscriptionFallback } from "./useServerTranscriptionFallback";

describe("useServerTranscriptionFallback", () => {
  it("never invokes the server transport without explicit audio upload opt-in", async () => {
    const transcribe = vi.fn().mockResolvedValue("text");
    const { result } = renderHook(() =>
      useServerTranscriptionFallback({
        enabled: true,
        allowAudioUpload: false,
        transcribe,
      })
    );

    await act(async () => {
      expect(await result.current.transcribeAudio(new Blob(["audio"]))).toBeNull();
    });

    expect(transcribe).not.toHaveBeenCalled();
    expect(result.current.status).toBe("blocked");
  });

  it("passes audio to the injected transport after opt-in", async () => {
    const transcribe = vi.fn().mockResolvedValue("  comandă transcrisă  ");
    const { result } = renderHook(() =>
      useServerTranscriptionFallback({
        enabled: true,
        allowAudioUpload: true,
        transcribe,
      })
    );

    await act(async () => {
      expect(await result.current.transcribeAudio(new Blob(["audio"]))).toBe("comandă transcrisă");
    });

    expect(transcribe).toHaveBeenCalledOnce();
    expect(result.current).toMatchObject({ status: "success", transcript: "comandă transcrisă" });
  });
});
