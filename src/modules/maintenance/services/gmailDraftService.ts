const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.send";
const GIS_SCRIPT_URL = "https://accounts.google.com/gsi/client";

type TokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type TokenClient = {
  requestAccessToken: (options?: { prompt?: string; hint?: string }) => void;
};

type GoogleIdentityServices = {
  accounts: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string;
        scope: string;
        hint?: string;
        callback: (response: TokenResponse) => void;
      }) => TokenClient;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleIdentityServices;
  }
}

let gisLoadPromise: Promise<void> | null = null;

export type GmailComposeInput = {
  senderEmail?: string;
  recipientEmail: string;
  subject: string;
  body: string;
};

export function buildGmailComposeUrl(input: GmailComposeInput): string {
  const params = new URLSearchParams({
    view: "cm",
    fs: "1",
    tf: "1",
    to: input.recipientEmail.trim(),
    su: input.subject,
    body: input.body,
  });
  const senderEmail = input.senderEmail?.trim();
  if (senderEmail) {
    params.set("authuser", senderEmail);
  }

  return `https://mail.google.com/mail/?${params.toString()}`;
}

export function prepareGmailComposeWindow(): Window | null {
  if (typeof window === "undefined") {
    return null;
  }

  const preparedWindow = window.open("", "_blank");
  if (!preparedWindow) {
    return null;
  }

  try {
    preparedWindow.document.title = "WorkControl Gmail";
    preparedWindow.document.body.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    preparedWindow.document.body.style.padding = "24px";
    preparedWindow.document.body.textContent = "Se pregateste Gmail...";
  } catch {
    // Some browsers restrict the temporary window document. Gmail navigation still works.
  }

  return preparedWindow;
}

export function openGmailCompose(
  input: GmailComposeInput,
  preparedWindow?: Window | null
): { gmailUrl: string; opened: boolean } {
  const gmailUrl = buildGmailComposeUrl(input);

  if (preparedWindow && !preparedWindow.closed) {
    try {
      preparedWindow.location.href = gmailUrl;
      return { gmailUrl, opened: true };
    } catch {
      // Fall through to opening Gmail directly.
    }
  }

  if (typeof window === "undefined") {
    return { gmailUrl, opened: false };
  }

  const openedWindow = window.open(gmailUrl, "_blank", "noopener,noreferrer");
  if (!openedWindow) {
    window.location.assign(gmailUrl);
    return { gmailUrl, opened: false };
  }

  return { gmailUrl, opened: true };
}

function loadGoogleIdentityServices(): Promise<void> {
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve();
  }

  if (!gisLoadPromise) {
    gisLoadPromise = new Promise((resolve, reject) => {
      const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SCRIPT_URL}"]`);

      if (existingScript) {
        existingScript.addEventListener("load", () => resolve(), { once: true });
        existingScript.addEventListener("error", () => reject(new Error("Nu am putut incarca Google Identity Services.")), {
          once: true,
        });
        return;
      }

      const script = document.createElement("script");
      script.src = GIS_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Nu am putut incarca Google Identity Services."));
      document.head.appendChild(script);
    });
  }

  return gisLoadPromise;
}

export function requestGmailAccessToken(senderEmail: string): Promise<string> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if (!clientId) {
    return Promise.reject(new Error("Lipseste VITE_GOOGLE_CLIENT_ID din .env."));
  }

  return loadGoogleIdentityServices().then(
    () =>
      new Promise((resolve, reject) => {
        const tokenClient = window.google?.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: GMAIL_SCOPE,
          hint: senderEmail || undefined,
          callback: (response) => {
            if (response.error || !response.access_token) {
              reject(new Error(response.error_description || response.error || "Autorizarea Gmail a esuat."));
              return;
            }

            resolve(response.access_token);
          },
        });

        if (!tokenClient) {
          reject(new Error("Google Identity Services nu este disponibil."));
          return;
        }

        tokenClient.requestAccessToken({
          prompt: "select_account",
          hint: senderEmail || undefined,
        });
      })
  );
}

function encodeHeader(value: string): string {
  if (/^[\x00-\x7F]*$/.test(value)) {
    return value;
  }

  return `=?UTF-8?B?${btoa(unescape(encodeURIComponent(value)))}?=`;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function base64UrlEncode(value: string): string {
  return btoa(unescape(encodeURIComponent(value)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function buildRawEmail(input: {
  from: string;
  to: string;
  subject: string;
  body: string;
  pdfBlob: Blob;
  fileName: string;
  attachments?: Array<{ blob: Blob; fileName: string; contentType: string }>;
}): Promise<string> {
  const boundary = `workcontrol_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const attachments = [
    { blob: input.pdfBlob, fileName: input.fileName, contentType: "application/pdf" },
    ...(input.attachments || []),
  ];
  const from = input.from ? `From: ${input.from}\r\n` : "";
  const messageLines = [
    `To: ${input.to}`,
    ...(from ? [from.trimEnd()] : []),
    `Subject: ${encodeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    input.body,
    "",
  ];
  for (const attachment of attachments) {
    const attachmentBase64 = arrayBufferToBase64(await attachment.blob.arrayBuffer());
    const attachmentLines = attachmentBase64.match(/.{1,76}/g)?.join("\r\n") || attachmentBase64;
    messageLines.push(
      `--${boundary}`,
      `Content-Type: ${attachment.contentType}; name="${attachment.fileName}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${attachment.fileName}"`,
      "",
      attachmentLines
    );
  }
  messageLines.push(`--${boundary}--`);
  const message = messageLines.join("\r\n");

  return base64UrlEncode(message);
}

export async function createGmailDraftWithPdfAttachment(input: {
  accessToken?: string;
  senderEmail: string;
  recipientEmail: string;
  subject: string;
  body: string;
  pdfBlob: Blob;
  fileName: string;
  attachments?: Array<{ blob: Blob; fileName: string; contentType: string }>;
}): Promise<{ draftId: string; gmailUrl: string }> {
  const accessToken = input.accessToken || await requestGmailAccessToken(input.senderEmail);
  const raw = await buildRawEmail({
    from: input.senderEmail,
    to: input.recipientEmail,
    subject: input.subject,
    body: input.body,
    pdfBlob: input.pdfBlob,
    fileName: input.fileName,
    attachments: input.attachments,
  });

  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: { raw },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "Nu am putut crea draftul Gmail.");
  }

  const draft = (await response.json()) as { id: string; message?: { id?: string; threadId?: string } };
  const authUser = encodeURIComponent(input.senderEmail || "0");

  return {
    draftId: draft.id,
    gmailUrl: `https://mail.google.com/mail/?authuser=${authUser}#drafts`,
  };
}

export async function sendGmailMessageWithPdfAttachment(input: {
  accessToken?: string;
  senderEmail: string;
  recipientEmail: string;
  subject: string;
  body: string;
  pdfBlob: Blob;
  fileName: string;
  attachments?: Array<{ blob: Blob; fileName: string; contentType: string }>;
}): Promise<{ messageId: string; gmailUrl: string }> {
  const accessToken = input.accessToken || await requestGmailAccessToken(input.senderEmail);
  const raw = await buildRawEmail({
    from: input.senderEmail,
    to: input.recipientEmail,
    subject: input.subject,
    body: input.body,
    pdfBlob: input.pdfBlob,
    fileName: input.fileName,
    attachments: input.attachments,
  });

  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "Nu am putut trimite emailul Gmail.");
  }

  const message = (await response.json()) as { id: string };
  const authUser = encodeURIComponent(input.senderEmail || "0");

  return {
    messageId: message.id,
    gmailUrl: `https://mail.google.com/mail/?authuser=${authUser}#sent`,
  };
}
