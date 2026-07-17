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
export function cleanAssistantCommandTranscript(value: string) {
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

function normalizeColloquialRomanian(value: string) {
  let output = value;
  const replacements: Array<[RegExp, string]> = [
    [/\b(?:duma|du\s+ma|bag(?:a|\u0103)\s*-?\s*ma)\s+(?:la|pe|in)\b/giu, "deschide"],
    [/\b(?:hai|vreau)\s+(?:sa\s+)?(?:ajung|intru|merg)\s+(?:la|pe|in)\b/giu, "deschide"],
    [/\bvreau\s+(?:la|pe|in)\b/giu, "deschide"],
    [/\bd(?:a|\u0103)\s*-?\s*i\s+drumu(?:l)?\s+la\s+pontaju(?:l)?\b/giu, "porneste pontajul"],
    [/\bd(?:a|\u0103)\s+drumu(?:l)?\s+la\s+pontaju(?:l)?\b/giu, "porneste pontajul"],
    [/\bbag(?:a|\u0103)\s+pontaju(?:l)?\b/giu, "porneste pontajul"],
    [/\bfa(?:-mi)?\s+(?:un\s+)?proiect\b/giu, "creeaza proiect"],
    [/\b(?:gata\s+(?:cu|pe)\s+pontaju(?:l)?|gata\s+pe\s+azi)\b/giu, "opreste pontajul"],
    [/\bfami\b/giu, "fa-mi"],
    [/\baratami\b/giu, "arata-mi"],
    [/\bspunemi\b/giu, "spune-mi"],
    [/\braportu\b/giu, "raportul"],
    [/\bpontaju\b/giu, "pontajul"],
    [/\bclientu\b/giu, "clientul"],
    [/\bliftu\b/giu, "liftul"],
    [/\bproiectu\b/giu, "proiectul"],
    [/\butilizatoru\b/giu, "utilizatorul"],
    [/\bgpsu\b/giu, "gps-ul"],
  ];

  replacements.forEach(([pattern, replacement]) => {
    output = output.replace(pattern, replacement);
  });
  return cleanCommandText(output);
}

/** Canonical form used by local parsers and the structured cloud interpreter. */
export function normalizeAssistantCommandText(value: string) {
  return normalizeColloquialRomanian(cleanAssistantCommandTranscript(value));
}
