function cleanCommandText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function comparisonToken(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("ro-RO")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

/** Removes a browser STT artefact where the same multi-word command is repeated verbatim. */
export function normalizeAssistantCommandText(value: string) {
  const clean = cleanCommandText(value);
  const tokens = clean.split(" ");
  const comparable = tokens.map(comparisonToken);

  for (let blockSize = 2; blockSize <= Math.floor(tokens.length / 2); blockSize += 1) {
    if (tokens.length % blockSize !== 0) continue;
    const repeatCount = tokens.length / blockSize;
    if (repeatCount < 2) continue;

    const repeatsExactly = comparable.every(
      (token, index) => token === comparable[index % blockSize]
    );
    if (repeatsExactly) return tokens.slice(0, blockSize).join(" ");
  }

  return clean;
}
