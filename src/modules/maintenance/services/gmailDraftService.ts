import { httpsCallable } from "firebase/functions";
import { functions } from "../../../lib/firebase/firebase";

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.compose";
const GIS_SCRIPT_URL = "https://accounts.google.com/gsi/client";
const GOOGLE_OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GMAIL_REDIRECT_STATE_KEY = "workcontrol.gmailRedirectState.v1";

type TokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type TokenClient = {
  requestAccessToken: (options?: { prompt?: string; hint?: string }) => void;
};

type GmailRedirectState = {
  state: string;
  senderEmail: string;
  redirectUri: string;
  createdAt: number;
};

export type GmailRedirectAuthorization = {
  accessToken: string;
  senderEmail: string;
  expiresIn: number | null;
};

export type GmailRedirectAuthorizationRequest = GmailRedirectState & {
  url: string;
};

export type SharedMaintenanceGmailAttachment = {
  path: string;
  fileName: string;
  contentType?: string;
};

export type SharedMaintenanceGmailSendInput = {
  companyId?: string;
  clientId: string;
  clientName?: string;
  reportId?: string;
  recipientEmail: string;
  subject: string;
  body: string;
  pdfPath: string;
  fileName: string;
  attachments?: SharedMaintenanceGmailAttachment[];
};

export type SharedMaintenanceGmailSendResult = {
  messageId: string;
  threadId?: string;
  sent: boolean;
  senderEmail: string;
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

function getGoogleClientId(): string {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error("Lipseste VITE_GOOGLE_CLIENT_ID din .env.");
  }
  return clientId;
}

function readRedirectState(): GmailRedirectState | null {
  try {
    const raw = window.sessionStorage.getItem(GMAIL_REDIRECT_STATE_KEY);
    return raw ? (JSON.parse(raw) as GmailRedirectState) : null;
  } catch {
    return null;
  }
}

function clearRedirectState() {
  window.sessionStorage.removeItem(GMAIL_REDIRECT_STATE_KEY);
}

function clearOAuthHashFromUrl() {
  if (!window.location.hash) return;
  window.history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
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

export function preloadGmailAuthorization(): Promise<void> {
  return loadGoogleIdentityServices();
}

function requestLoadedGmailAccessToken(clientId: string, senderEmail: string): Promise<string> {
  return new Promise((resolve, reject) => {
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
  });
}

export function requestGmailAccessToken(senderEmail: string): Promise<string> {
  let clientId = "";
  try {
    clientId = getGoogleClientId();
  } catch (error) {
    return Promise.reject(error);
  }

  if (window.google?.accounts?.oauth2) {
    return requestLoadedGmailAccessToken(clientId, senderEmail);
  }

  return loadGoogleIdentityServices().then(() => requestLoadedGmailAccessToken(clientId, senderEmail));
}

export function shouldUseGmailRedirectAuthorization(): boolean {
  const userAgent = navigator.userAgent || "";
  const isMobileBrowser = /Android|iPhone|iPad|iPod|SamsungBrowser/i.test(userAgent);
  const isNarrowViewport = window.matchMedia?.("(max-width: 768px)").matches ?? false;
  return isMobileBrowser || isNarrowViewport;
}

export function createGmailRedirectAuthorizationRequest(senderEmail: string): GmailRedirectAuthorizationRequest {
  const clientId = getGoogleClientId();
  const redirectUri = `${window.location.origin}/maintenance?tab=report`;
  const state = `wc_gmail_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "token",
    scope: GMAIL_SCOPE,
    include_granted_scopes: "true",
    prompt: "select_account",
    state,
  });
  if (senderEmail) {
    params.set("login_hint", senderEmail);
  }

  return {
    state,
    senderEmail,
    redirectUri,
    createdAt: Date.now(),
    url: `${GOOGLE_OAUTH_AUTHORIZE_URL}?${params.toString()}`,
  };
}

export function storeGmailRedirectAuthorizationRequest(request: GmailRedirectAuthorizationRequest): void {
  const redirectState: GmailRedirectState = {
    state: request.state,
    senderEmail: request.senderEmail,
    redirectUri: request.redirectUri,
    createdAt: request.createdAt,
  };
  window.sessionStorage.setItem(GMAIL_REDIRECT_STATE_KEY, JSON.stringify(redirectState));
}

export function startGmailRedirectAuthorization(senderEmail: string): string {
  const request = createGmailRedirectAuthorizationRequest(senderEmail);
  storeGmailRedirectAuthorizationRequest(request);
  window.location.href = request.url;
  return request.url;
}

export function consumeGmailRedirectAuthorization(): GmailRedirectAuthorization | null {
  if (!window.location.hash) return null;

  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const accessToken = params.get("access_token");
  const error = params.get("error");
  if (!accessToken && !error) return null;

  const storedState = readRedirectState();
  const returnedState = params.get("state") || "";
  clearOAuthHashFromUrl();
  clearRedirectState();

  if (error) {
    throw new Error(params.get("error_description") || error);
  }
  if (!accessToken) {
    throw new Error("Autorizarea Gmail nu a returnat un token valid.");
  }
  if (storedState?.state && returnedState && storedState.state !== returnedState) {
    throw new Error("Autorizarea Gmail nu a putut fi verificata. Incearca din nou.");
  }

  const expiresIn = Number(params.get("expires_in") || "");
  return {
    accessToken,
    senderEmail: storedState?.senderEmail || "",
    expiresIn: Number.isFinite(expiresIn) ? expiresIn : null,
  };
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
  const messageId = draft.message?.id ? `/${encodeURIComponent(draft.message.id)}` : "";

  return {
    draftId: draft.id,
    gmailUrl: `https://mail.google.com/mail/?authuser=${authUser}#drafts${messageId}`,
  };
}

export function openGmailDraft(gmailUrl: string): void {
  const url = new URL(gmailUrl);
  if (url.protocol !== "https:" || url.hostname !== "mail.google.com") {
    throw new Error("Linkul draftului Gmail nu este valid.");
  }
  window.location.assign(url.toString());
}

export async function sendSharedMaintenanceGmailReport(
  input: SharedMaintenanceGmailSendInput
): Promise<SharedMaintenanceGmailSendResult> {
  const sendReport = httpsCallable<SharedMaintenanceGmailSendInput, SharedMaintenanceGmailSendResult>(
    functions,
    "createMaintenanceGmailDraft"
  );
  const result = await sendReport(input);
  const data = result.data;

  if (!data?.sent || !data?.messageId || !data?.senderEmail) {
    throw new Error("Nu am putut confirma trimiterea emailului Gmail.");
  }

  return data;
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
