type DownloadFileFromUrlOptions = {
  url: string;
  fileName?: string;
};

function safeFileName(fileName?: string) {
  const clean = (fileName || "document")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ");

  return clean || "document";
}

export function withAttachmentDisposition(url: string, fileName?: string) {
  if (/^(data|blob):/i.test(url.trim())) return url;

  const safeName = safeFileName(fileName);

  try {
    const parsed = new URL(url, window.location.href);
    parsed.searchParams.set(
      "response-content-disposition",
      `attachment; filename="${safeName}"`
    );
    return parsed.toString();
  } catch {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}response-content-disposition=${encodeURIComponent(
      `attachment; filename="${safeName}"`
    )}`;
  }
}

function clickDownloadLink(href: string, fileName: string, openInNewTab = false) {
  const link = document.createElement("a");
  link.href = href;
  link.download = fileName;
  link.rel = "noopener noreferrer";
  if (openInNewTab) link.target = "_blank";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export async function downloadFileFromUrl({ url, fileName }: DownloadFileFromUrlOptions) {
  if (!url) throw new Error("Lipseste URL-ul documentului.");

  const safeName = safeFileName(fileName);
  const downloadUrl = withAttachmentDisposition(url, safeName);

  try {
    const response = await fetch(downloadUrl, {
      credentials: "omit",
      mode: "cors",
    });
    if (!response.ok) throw new Error(`Download failed with status ${response.status}`);

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    clickDownloadLink(objectUrl, safeName);

    window.setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
    }, 60_000);
  } catch (error) {
    console.warn("[downloadFileFromUrl][blob-fallback]", error);
    clickDownloadLink(downloadUrl, safeName);
  }
}
