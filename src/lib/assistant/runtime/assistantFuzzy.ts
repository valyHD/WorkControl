export function normalizeAssistantText(value?: string | null) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function compactAssistantText(value?: string | null) {
  return normalizeAssistantText(value).replace(/\s+/g, "");
}

export function compactVehiclePlate(value?: string | null) {
  return compactAssistantText(value).toUpperCase();
}

export function assistantTokens(value?: string | null) {
  return normalizeAssistantText(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

export function levenshteinDistance(left: string, right: string, maxDistance = 3) {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;
  if (Math.abs(left.length - right.length) > maxDistance) return maxDistance + 1;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array(right.length + 1).fill(0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    let rowMin = current[0];

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        previous[rightIndex - 1] + cost
      );
      rowMin = Math.min(rowMin, current[rightIndex]);
    }

    if (rowMin > maxDistance) return maxDistance + 1;
    for (let index = 0; index <= right.length; index += 1) {
      previous[index] = current[index];
    }
  }

  return previous[right.length];
}

export function tokenMatches(label: string, token: string) {
  if (!label || !token) return false;
  if (label.includes(token)) return true;
  if (token.length < 4) return false;

  return assistantTokens(label).some((word) => {
    if (word.includes(token) || token.includes(word)) return true;
    const maxDistance = token.length >= 6 ? 2 : 1;
    return levenshteinDistance(word, token, maxDistance) <= maxDistance;
  });
}

export function scoreAssistantText(labelText: string, queryText: string) {
  const label = normalizeAssistantText(labelText);
  const query = normalizeAssistantText(queryText);
  const compactLabel = compactAssistantText(label);
  const compactQuery = compactAssistantText(query);
  const tokens = assistantTokens(query);

  if (!label || !query) return 0;

  let score = 0;
  if (label === query) score += 1;
  if (label.includes(query)) score += 0.72;
  if (compactQuery.length >= 3 && compactLabel.includes(compactQuery)) score += 0.62;

  tokens.forEach((token) => {
    if (tokenMatches(label, token)) score += 0.18;
    if (compactLabel.includes(token)) score += 0.08;
  });

  if (tokens.length > 0 && tokens.every((token) => tokenMatches(label, token) || compactLabel.includes(token))) {
    score += 0.28;
  }

  return Math.max(0, Math.min(1, score));
}

export function rankAssistantMatches<T>(
  items: T[],
  query: string,
  getLabel: (item: T) => string,
  minScore = 0.25
) {
  return items
    .map((item) => ({ item, score: scoreAssistantText(getLabel(item), query) }))
    .filter((entry) => entry.score >= minScore)
    .sort((a, b) => b.score - a.score);
}
