import { memo, useMemo, useState } from "react";

type SafeImageProps = {
  src?: string | null;
  alt: string;
  className?: string;
  fallbackText?: string;
  loading?: "lazy" | "eager";
  decoding?: "async" | "sync" | "auto";
  sizes?: string;
};

function initialsFromLabel(label: string) {
  const compact = label.trim();
  if (!compact) return "?";
  const parts = compact.split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join("") || "?";
}

function SafeImageComponent({
  src,
  alt,
  className,
  fallbackText,
  loading = "lazy",
  decoding = "async",
  sizes,
}: SafeImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const displayFallback = failed || !src;
  const fallbackLabel = useMemo(() => initialsFromLabel(fallbackText || alt), [fallbackText, alt]);

  if (displayFallback) {
    return <span aria-label={alt}>{fallbackLabel}</span>;
  }

  return (
    <>
      {!loaded && <span className="safe-image-skeleton" aria-hidden="true" />}
      <img
        src={src}
        alt={alt}
        className={className}
        loading={loading}
        decoding={decoding}
        sizes={sizes}
        onLoad={() => setLoaded(true)}
        onError={() => {
          setLoaded(false);
          setFailed(true);
        }}
      />
    </>
  );
}

const SafeImage = memo(SafeImageComponent);

export default SafeImage;
