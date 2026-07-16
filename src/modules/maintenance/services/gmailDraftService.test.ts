import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGmailDraftWithPdfAttachment,
  createGmailRedirectAuthorizationRequest,
  openGmailDraft,
} from "./gmailDraftService";

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

describe("gmailDraftService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("creates a Gmail draft whose MIME body contains the PDF as an attachment", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        id: "draft-1",
        message: { id: "message-1" },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createGmailDraftWithPdfAttachment({
      accessToken: "test-access-token",
      senderEmail: "sender@example.test",
      recipientEmail: "client@example.test",
      subject: "Raport revizie",
      body: "Raportul este atasat.",
      pdfBlob: new Blob(["%PDF-test-content"], { type: "application/pdf" }),
      fileName: "raport-revizie.pdf",
    });

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(request.body)) as { message: { raw: string } };
    const mimeMessage = decodeBase64Url(payload.message.raw);

    expect(mimeMessage).toContain('Content-Type: application/pdf; name="raport-revizie.pdf"');
    expect(mimeMessage).toContain('Content-Disposition: attachment; filename="raport-revizie.pdf"');
    expect(mimeMessage).toContain(btoa("%PDF-test-content"));
    expect(result.gmailUrl).toBe(
      "https://mail.google.com/mail/?authuser=sender%40example.test#drafts/message-1"
    );
  });

  it("rejects non-Gmail destinations before navigation", () => {
    expect(() => openGmailDraft("https://example.test/fake-draft")).toThrow(
      "Linkul draftului Gmail nu este valid."
    );
  });

  it("uses one stable maintenance callback and requests only Gmail Compose", () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "test-client.apps.googleusercontent.com");
    window.history.replaceState(null, "", "/maintenance?tab=report&assistant=report");

    const request = createGmailRedirectAuthorizationRequest("sender@example.test");
    const authorizationUrl = new URL(request.url);

    expect(request.redirectUri).toBe(`${window.location.origin}/maintenance?tab=report`);
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(request.redirectUri);
    expect(authorizationUrl.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/gmail.compose"
    );
  });
});
