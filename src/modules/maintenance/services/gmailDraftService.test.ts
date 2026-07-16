import { describe, expect, it } from "vitest";
import { buildGmailComposeUrl } from "./gmailDraftService";

describe("buildGmailComposeUrl", () => {
  it("builds a Gmail compose URL with sender, recipient, subject and PDF link", () => {
    const url = new URL(
      buildGmailComposeUrl({
        senderEmail: "tehnician@example.test",
        recipientEmail: "client@example.test",
        subject: "Raport revizie 16.07.2026",
        body: ["Buna ziua,", "", "Raport PDF: https://storage.example.test/report.pdf"].join("\n"),
      })
    );

    expect(url.origin).toBe("https://mail.google.com");
    expect(url.pathname).toBe("/mail/");
    expect(url.searchParams.get("view")).toBe("cm");
    expect(url.searchParams.get("fs")).toBe("1");
    expect(url.searchParams.get("tf")).toBe("1");
    expect(url.searchParams.get("authuser")).toBe("tehnician@example.test");
    expect(url.searchParams.get("to")).toBe("client@example.test");
    expect(url.searchParams.get("su")).toBe("Raport revizie 16.07.2026");
    expect(url.searchParams.get("body")).toContain("https://storage.example.test/report.pdf");
  });
});
