export type RomanianSpeechValueKind =
  "plate" | "kilometers" | "date" | "email" | "phone" | "liftNumber";

const NUMBER_VALUES: Record<string, number> = {
  zero: 0,
  un: 1,
  unu: 1,
  una: 1,
  o: 1,
  doi: 2,
  doua: 2,
  trei: 3,
  patru: 4,
  cinci: 5,
  sase: 6,
  sapte: 7,
  opt: 8,
  noua: 9,
  zece: 10,
  unsprezece: 11,
  doisprezece: 12,
  douasprezece: 12,
  treisprezece: 13,
  paisprezece: 14,
  cincisprezece: 15,
  saisprezece: 16,
  saptesprezece: 17,
  optsprezece: 18,
  nouasprezece: 19,
};

const TENS_VALUES: Record<string, number> = {
  douazeci: 20,
  treizeci: 30,
  patruzeci: 40,
  cincizeci: 50,
  saizeci: 60,
  saptezeci: 70,
  optzeci: 80,
  nouazeci: 90,
};

const MONTH_VALUES: Record<string, number> = {
  ianuarie: 1,
  ian: 1,
  februarie: 2,
  feb: 2,
  martie: 3,
  mar: 3,
  aprilie: 4,
  apr: 4,
  mai: 5,
  iunie: 6,
  iun: 6,
  iulie: 7,
  iul: 7,
  august: 8,
  aug: 8,
  septembrie: 9,
  sept: 9,
  sep: 9,
  octombrie: 10,
  oct: 10,
  noiembrie: 11,
  noi: 11,
  decembrie: 12,
  dec: 12,
};

const COUNTY_ALIASES: Record<string, string> = {
  alba: "AB",
  arad: "AR",
  arges: "AG",
  bacau: "BC",
  bihor: "BH",
  bistrita: "BN",
  botosani: "BT",
  braila: "BR",
  brasov: "BV",
  bucuresti: "B",
  buzau: "BZ",
  calarasi: "CL",
  caras: "CS",
  cluj: "CJ",
  constanta: "CT",
  covasna: "CV",
  dambovita: "DB",
  dolj: "DJ",
  galati: "GL",
  giurgiu: "GR",
  gorj: "GJ",
  harghita: "HR",
  hunedoara: "HD",
  ialomita: "IL",
  iasi: "IS",
  ilfov: "IF",
  maramures: "MM",
  mehedinti: "MH",
  mures: "MS",
  neamt: "NT",
  olt: "OT",
  prahova: "PH",
  salaj: "SJ",
  satu: "SM",
  sibiu: "SB",
  suceava: "SV",
  teleorman: "TR",
  timis: "TM",
  tulcea: "TL",
  valcea: "VL",
  vaslui: "VS",
  vrancea: "VN",
};

const COUNTY_CODES = new Set(["B", ...Object.values(COUNTY_ALIASES)]);

const LETTER_NAMES: Record<string, string> = {
  a: "A",
  be: "B",
  b: "B",
  ce: "C",
  c: "C",
  de: "D",
  d: "D",
  e: "E",
  ef: "F",
  f: "F",
  ge: "G",
  g: "G",
  ha: "H",
  h: "H",
  i: "I",
  ji: "J",
  j: "J",
  ca: "K",
  k: "K",
  el: "L",
  l: "L",
  em: "M",
  m: "M",
  en: "N",
  n: "N",
  o: "O",
  pe: "P",
  p: "P",
  chiu: "Q",
  q: "Q",
  er: "R",
  r: "R",
  es: "S",
  s: "S",
  te: "T",
  t: "T",
  u: "U",
  ve: "V",
  v: "V",
  ics: "X",
  x: "X",
  igrec: "Y",
  y: "Y",
  zet: "Z",
  z: "Z",
};

function normalizeRomanian(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("ro-RO")
    .replace(/[’']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function numberTokens(value: string) {
  return normalizeRomanian(value).match(/[a-z]+|\d+/g) ?? [];
}

export function parseRomanianSpokenNumber(value: string): number | null {
  const tokens = numberTokens(value).filter((token) => token !== "si" && token !== "de");
  if (tokens.length === 0) return null;

  let total = 0;
  let current = 0;
  let recognized = false;

  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      current += Number(token);
      recognized = true;
      continue;
    }
    if (token in NUMBER_VALUES) {
      current += NUMBER_VALUES[token];
      recognized = true;
      continue;
    }
    if (token in TENS_VALUES) {
      current += TENS_VALUES[token];
      recognized = true;
      continue;
    }
    if (token === "suta" || token === "sute") {
      current = (current || 1) * 100;
      recognized = true;
      continue;
    }
    if (token === "mie" || token === "mii") {
      total += (current || 1) * 1_000;
      current = 0;
      recognized = true;
      continue;
    }
    if (token === "milion" || token === "milioane") {
      total += (current || 1) * 1_000_000;
      current = 0;
      recognized = true;
      continue;
    }
    return null;
  }

  return recognized ? total + current : null;
}

function formatDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function correctRomanianPlate(value: string) {
  const direct = normalizeRomanian(value)
    .toUpperCase()
    .match(/\b(B|[A-Z]{2})\s*[- ]?\s*(\d{2,3})\s*[- ]?\s*([A-Z]{3})\b/);
  if (direct && COUNTY_CODES.has(direct[1])) return `${direct[1]} ${direct[2]} ${direct[3]}`;

  const tokens = numberTokens(value).filter(
    (token) => !["numar", "numarul", "inmatriculare", "masina", "masinii", "auto"].includes(token)
  );
  const countyIndex = tokens.findIndex((token) => {
    const candidate = COUNTY_ALIASES[token] ?? (token === "be" ? "B" : token.toUpperCase());
    return COUNTY_CODES.has(candidate);
  });
  if (countyIndex < 0) return value.trim().toUpperCase();

  const countyToken = tokens[countyIndex];
  const county =
    COUNTY_ALIASES[countyToken] ?? (countyToken === "be" ? "B" : countyToken.toUpperCase());
  const afterCounty = tokens.slice(countyIndex + 1);
  let letterStart = -1;
  for (let index = 1; index < afterCounty.length; index += 1) {
    if (!LETTER_NAMES[afterCounty[index]]) continue;
    const possibleLetters = afterCounty
      .slice(index)
      .map((token) => LETTER_NAMES[token])
      .filter(Boolean);
    if (possibleLetters.length >= 3) {
      const possibleNumber = parseRomanianSpokenNumber(afterCounty.slice(0, index).join(" "));
      if (possibleNumber !== null) {
        letterStart = index;
        break;
      }
    }
  }

  if (letterStart < 0) return value.trim().toUpperCase();
  const registrationNumber = parseRomanianSpokenNumber(afterCounty.slice(0, letterStart).join(" "));
  const letters = afterCounty
    .slice(letterStart)
    .map((token) => LETTER_NAMES[token])
    .filter(Boolean)
    .slice(0, 3)
    .join("");
  if (registrationNumber === null || registrationNumber < 1 || letters.length !== 3) {
    return value.trim().toUpperCase();
  }
  return `${county} ${registrationNumber} ${letters}`;
}

export function correctRomanianKilometers(value: string) {
  const normalized = normalizeRomanian(value)
    .replace(/\b(kilometri|kilometrii|kilometraj|km|curenti|actuali)\b/g, " ")
    .replace(/(?<=\d)[.,\s](?=\d{3}\b)/g, "")
    .trim();
  if (/^\d+(?:[.,]\d+)?$/.test(normalized)) {
    const numeric = Number(normalized.replace(",", "."));
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
  }
  const spoken = parseRomanianSpokenNumber(normalized);
  return spoken !== null && spoken >= 0 ? spoken : null;
}

export function correctRomanianDate(value: string, referenceDate = new Date()) {
  const normalized = normalizeRomanian(value);
  const relativeOffset =
    normalized === "azi" ? 0 : normalized === "maine" ? 1 : normalized === "poimaine" ? 2 : null;
  if (relativeOffset !== null) {
    const date = new Date(referenceDate);
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + relativeOffset);
    return formatDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
  }

  const isoMatch = normalized.match(/^((?:19|20)\d{2})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) return formatDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));

  const numericMatch = normalized.match(/\b(\d{1,2})[./-](\d{1,2})[./-]((?:19|20)?\d{2})\b/);
  if (numericMatch) {
    let year = Number(numericMatch[3]);
    if (year < 100) year += 2000;
    return formatDate(year, Number(numericMatch[2]), Number(numericMatch[1]));
  }

  const tokens = numberTokens(normalized);
  const monthIndex = tokens.findIndex((token) => token in MONTH_VALUES);
  if (monthIndex < 0) return null;
  const monthToken = tokens[monthIndex];
  if (!monthToken) return null;
  const month = MONTH_VALUES[monthToken];
  if (!month) return null;
  const day = parseRomanianSpokenNumber(tokens.slice(0, monthIndex).join(" "));
  const yearTokens = tokens.slice(monthIndex + 1);
  const year =
    yearTokens.length > 0
      ? parseRomanianSpokenNumber(yearTokens.join(" "))
      : referenceDate.getFullYear();
  if (day === null || year === null) return null;
  return formatDate(year, month, day);
}

export function correctRomanianEmail(value: string) {
  return normalizeRomanian(value)
    .replace(/\bcoada de maimuta\b/g, "@")
    .replace(/\b(arond|arondul|at)\b/g, "@")
    .replace(/\b(punct|dot)\b/g, ".")
    .replace(/\b(linie jos|underscore)\b/g, "_")
    .replace(/\b(liniuta|minus)\b/g, "-")
    .replace(/\s+/g, "")
    .replace(/\.{2,}/g, ".");
}

export function correctRomanianPhone(value: string) {
  const normalized = normalizeRomanian(value)
    .replace(/\b(numar|numarul|telefon|telefonul|mobil)\b/g, " ")
    .trim();
  const hasInternationalPrefix = /^plus\s+(?:patruzeci|4\s*0)\b/.test(normalized);
  const withoutPrefix = hasInternationalPrefix
    ? normalized.replace(/^plus\s+(?:patruzeci|4\s*0)\b/, "")
    : normalized;
  const digits = numberTokens(withoutPrefix)
    .flatMap((token) => {
      if (/^\d+$/.test(token)) return token.split("");
      const digit = NUMBER_VALUES[token];
      return digit !== undefined && digit <= 9 ? [String(digit)] : [];
    })
    .join("");
  return `${hasInternationalPrefix ? "+40" : ""}${digits}`;
}

export function correctRomanianLiftNumber(value: string) {
  const normalized = normalizeRomanian(value)
    .replace(/\b(lift|liftul|ascensor|ascensorul|numar|numarul)\b/g, " ")
    .trim();
  const direct = normalized.toUpperCase().match(/\b([A-Z]{1,3})\s*[- ]?\s*(\d{1,5})\b/);
  if (direct) return `${direct[1]}${direct[2]}`;

  const tokens = numberTokens(normalized);
  const firstToken = tokens[0];
  const letter = firstToken ? LETTER_NAMES[firstToken] : undefined;
  const number = parseRomanianSpokenNumber(tokens.slice(1).join(" "));
  if (!letter || number === null) return value.trim().toUpperCase().replace(/\s+/g, "");
  return `${letter}${number}`;
}

export function correctRomanianSpeechValue(kind: RomanianSpeechValueKind, value: string) {
  switch (kind) {
    case "plate":
      return correctRomanianPlate(value);
    case "kilometers":
      return correctRomanianKilometers(value);
    case "date":
      return correctRomanianDate(value);
    case "email":
      return correctRomanianEmail(value);
    case "phone":
      return correctRomanianPhone(value);
    case "liftNumber":
      return correctRomanianLiftNumber(value);
  }
}
