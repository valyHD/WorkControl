import { memo, useEffect, useMemo, useState } from "react";

type SafeImageProps = {
  src?: string | null;
  alt: string;
  className?: string;
  fallbackText?: string;
  loading?: "lazy" | "eager";
  decoding?: "async" | "sync" | "auto";
  fetchPriority?: "high" | "low" | "auto";
  sizes?: string;
  /** Optional wrapper class — useful when you need the skeleton to fill a container */
  wrapperClassName?: string;
};

const loadedImageUrls = new Set<string>();
const pendingImageUrls = new Set<string>();

export function preloadImageUrls(urls: Array<string | null | undefined>, limit = 36): void {
  if (typeof window === "undefined") return;

  urls
    .filter((url): url is string => Boolean(url))
    .slice(0, limit)
    .forEach((url) => {
      if (loadedImageUrls.has(url) || pendingImageUrls.has(url)) return;

      pendingImageUrls.add(url);
      const image = new Image();
      image.decoding = "async";
      image.onload = () => {
        loadedImageUrls.add(url);
        pendingImageUrls.delete(url);
      };
      image.onerror = () => {
        pendingImageUrls.delete(url);
      };
      image.src = url;
    });
}

function initialsFromLabel(label: string): string {
  const compact = (label || "").trim();
  if (!compact) return "?";
  const parts = compact.split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join("") || "?";
}

function SafeImageComponent({
  src,
  alt,
  className,
  fallbackText,
  loading = "lazy",
  decoding = "async",
  fetchPriority = "auto",
  sizes,
  wrapperClassName,
}: SafeImageProps) {
  const [loaded, setLoaded] = useState(() => Boolean(src && loadedImageUrls.has(src)));
  const [failed, setFailed] = useState(false);

  const displayFallback = failed || !src;
  const fallbackLabel = useMemo(
    () => initialsFromLabel(fallbackText || alt),
    [fallbackText, alt]
  );

  useEffect(() => {
    setLoaded(Boolean(src && loadedImageUrls.has(src)));
    setFailed(false);
  }, [src]);

  if (displayFallback) {
    return (
      <span
        className={`safe-image-fallback ${wrapperClassName ?? ""}`}
        aria-label={alt}
        role="img"
      >
        {fallbackLabel}
      </span>
    );
  }

  return (
    <span
      className={`safe-image-wrap ${wrapperClassName ?? ""}`}
      aria-label={alt}
      role="img"
      style={{ display: "contents" }}
    >
      {!loaded && (
        <span
          className="safe-image-skeleton"
          aria-hidden="true"
          style={className ? undefined : { display: "block", width: "100%", height: "100%" }}
        />
      )}
      <img
        src={src}
        alt={alt}
        className={`${className ?? ""} ${loaded ? "" : "safe-image-loading"}`}
        loading={loading}
        decoding={decoding}
        fetchPriority={fetchPriority}
        sizes={sizes}
        onLoad={() => {
          if (src) loadedImageUrls.add(src);
          setLoaded(true);
        }}
        onError={() => {
          setLoaded(false);
          setFailed(true);
        }}
        style={loaded ? undefined : { opacity: 0, position: "absolute", pointerEvents: "none" }}
      />
    </span>
  );
}

const SafeImage = memo(SafeImageComponent);
export default SafeImage;
