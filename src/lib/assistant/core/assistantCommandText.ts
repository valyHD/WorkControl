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

function collapseConsecutiveSpeechRepeats(value: string) {
  const tokens = value.split(" ").filter(Boolean);
  let changed = true;

  while (changed) {
    changed = false;
    const comparable = tokens.map(comparisonToken);
    const maxBlockSize = Math.min(6, Math.floor(tokens.length / 2));

    for (let blockSize = maxBlockSize; blockSize >= 1 && !changed; blockSize -= 1) {
      for (let start = 0; start + blockSize * 2 <= tokens.length; start += 1) {
        if (tokens.slice(start, start + blockSize).some((token) => /\d/.test(token))) continue;
        const repeated = Array.from({ length: blockSize }, (_, offset) =>
          comparable[start + offset] === comparable[start + blockSize + offset]
        ).every(Boolean);
        if (!repeated) continue;

        tokens.splice(start + blockSize, blockSize);
        changed = true;
        break;
      }
    }
  }

  return tokens.join(" ");
}

/** Removes browser STT artefacts while preserving the wording used for audit. */
export function cleanAssistantCommandTranscript(value: string) {
  const clean = cleanCommandText(value);
  return collapseConsecutiveSpeechRepeats(clean);
}

function normalizeColloquialRomanian(value: string) {
  let output = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const replacements: Array<[RegExp, string]> = [
    [
      /\b(?:duma|du\s*-?\s*(?:ma|ne|te)|dute|bagama|bag(?:a)?\s*-?\s*ma|pune\s*-?\s*ma|arunca\s*-?\s*ma)\s+(?:la|pe|in)\b/giu,
      "deschide",
    ],
    [/\b(?:deschide|arata)\s*-?\s*mi\b/giu, "deschide"],
    [/\b(?:ia\s+)?(?:vezi|uita\s*-?\s*te)\s+(?:la|pe|in)\b/giu, "deschide"],
    [/\b(?:bag(?:a)?|porneste)\s*-?\s*(?:ma|mi)?\s*(?:la\s+)?pontaju(?:l)?\b/giu, "porneste pontajul"],
    [/\bponteaza\s*-?\s*ma\s+(?:la|pe)\b/giu, "porneste pontajul pe"],
    [/\b(?:incep|m\s*-?\s*am\s+apucat\s+de)\s+(?:munca\s+)?(?:la|pe)\b/giu, "porneste pontajul pe"],
    [/\b(?:zimi|zi\s*-?\s*mi)\b/giu, "spune-mi"],
    [/\bschimba\s*-?\s*i\b/giu, "schimba"],
    [/\bpune\s*-?\s*i\b/giu, "pune"],
    [
      /\b(?:duma|du\s*-?\s*(?:ma|mă|ne)|bag(?:a|\u0103)\s*-?\s*(?:ma|mă)|pune\s*-?\s*(?:ma|mă))\s+(?:la|pe|in)\b/giu,
      "deschide",
    ],
    [/\b(?:deschide|arata|arată)\s*-?\s*mi\b/giu, "deschide"],
    [/\b(?:hai|vreau)\s+(?:sa\s+)?(?:ajung|intru|merg|vad)\s+(?:la|pe|in)?\b/giu, "deschide "],
    [/\bhai\s+(?:la|pe|in)\b/giu, "deschide"],
    [/\bunde\s+(?:gasesc|găsesc|este|e)\b/giu, "deschide"],
    [/\bvreau\s+(?:la|pe|in)\b/giu, "deschide"],
    [/\bd(?:a|\u0103)\s*-?\s*i\s+drumu(?:l)?\s+la\s+pontaju(?:l)?\b/giu, "porneste pontajul"],
    [/\bd(?:a|\u0103)\s+drumu(?:l)?\s+la\s+pontaju(?:l)?\b/giu, "porneste pontajul"],
    [/\b(?:bag(?:a|\u0103)|porneste|pornește)\s*-?\s*(?:ma|mă|mi)?\s*(?:la\s+)?pontaju(?:l)?\b/giu, "porneste pontajul"],
    [/\b(?:ponteaza|pontează)\s*-?\s*(?:ma|mă)\s+(?:la|pe)\b/giu, "porneste pontajul pe"],
    [/\b(?:incep|încep|m\s*-?\s*am\s+apucat\s+de)\s+(?:munca\s+)?(?:la|pe)\b/giu, "porneste pontajul pe"],
    [/\bfa(?:-mi)?\s+(?:un\s+)?proiect\b/giu, "creeaza proiect"],
    [
      /\b(?:gata\s+(?:cu|pe)\s+pontaju(?:l)?|gata\s+pe\s+azi|am\s+(?:terminat|plecat)(?:\s+pe\s+azi)?|inchide\s+(?:ziua|programul))\b/giu,
      "opreste pontajul",
    ],
    [/\bopreste\s*-?\s*mi\s+pontaju(?:l)?\b/giu, "opreste pontajul"],
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
    [/\bbonu\b/giu, "bonul"],
    [/\bconcediu(?:l|lui)?\b/giu, "concediu"],
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
