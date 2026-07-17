import { tokenMatches } from "../../../lib/assistant/runtime/assistantFuzzy";
import type { MaintenanceClient } from "../../../types/maintenance";
import { filterActiveMaintenanceClients } from "../utils/maintenanceClientStatus";

export type MaintenanceAddressLiftGroup = {
  key: string;
  address: string;
  lifts: string[];
};

const SPOKEN_NUMBER_WORDS: Record<string, string> = {
  unu: "1",
  una: "1",
  doi: "2",
  doua: "2",
  trei: "3",
  patru: "4",
  cinci: "5",
  sase: "6",
  sapte: "7",
  opt: "8",
  noua: "9",
  zece: "10",
};

export function normalizeMaintenanceAssistantText(value: string) {
  let normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  normalized = normalized.replace(
    /\b(?:bloc(?:ul)?\s+)?(?:litera\s+)?([a-z])\s+(unu|una|doi|doua|trei|patru|cinci|sase|sapte|opt|noua|zece)\b/g,
    (_match, letter: string, numberWord: string) => `${letter}${SPOKEN_NUMBER_WORDS[numberWord]}`
  );
  normalized = normalized.replace(
    /\b(?:bloc(?:ul)?\s+)?ce\s+(unu|una|doi|doua|trei|patru|cinci|sase|sapte|opt|noua|zece)\b/g,
    (_match, numberWord: string) => `c${SPOKEN_NUMBER_WORDS[numberWord]}`
  );
  return normalized.replace(/\s+/g, " ").trim();
}

const WEAK_QUERY_TOKENS = new Set([
  "adresa",
  "asociatia",
  "asociatie",
  "bl",
  "bloc",
  "blocul",
  "client",
  "clientul",
  "de",
  "din",
  "la",
  "lift",
  "liftul",
  "pe",
  "pentru",
  "proprietari",
  "proprietarilor",
  "sc",
  "scara",
]);

export function tokenizeMaintenanceAssistantText(value: string) {
  return normalizeMaintenanceAssistantText(value)
    .split(" ")
    .filter((token) => token && !WEAK_QUERY_TOKENS.has(token));
}

export function buildAddressLiftGroups(client: MaintenanceClient): MaintenanceAddressLiftGroup[] {
  const mainAddress = client.address.trim();
  const allClientLifts = Array.from(
    new Set(
      ((client.liftNumbers || []).length
        ? client.liftNumbers
        : client.liftNumber
          ? [client.liftNumber]
          : []
      ).filter(Boolean)
    )
  );
  const secondaryGroups = (client.addresses || []).map((address) => ({
    key: address.id,
    address: (address.label || address.street || "").trim(),
    lifts: Array.from(
      new Set(
        (address.lifts || [])
          .map((lift) => lift.serialNumber || lift.label || "")
          .map((item) => item.trim())
          .filter(Boolean)
      )
    ),
  }));

  const secondaryLiftSet = new Set(secondaryGroups.flatMap((group) => group.lifts));
  const mainLifts = allClientLifts.filter((lift) => !secondaryLiftSet.has(lift));
  const groups: MaintenanceAddressLiftGroup[] = [];

  if (mainAddress || mainLifts.length) {
    groups.push({
      key: `${client.id}_main`,
      address: mainAddress || "Adresa principala",
      lifts: mainLifts,
    });
  }
  secondaryGroups.forEach((group) => {
    if (group.address || group.lifts.length) {
      groups.push({
        key: group.key,
        address: group.address || "Adresa secundara",
        lifts: group.lifts,
      });
    }
  });
  if (groups.length === 0) {
    groups.push({ key: `${client.id}_empty`, address: "-", lifts: [] });
  }
  return groups;
}

function createSearchProfile(client: MaintenanceClient) {
  const names = [client.name].filter(Boolean).map(normalizeMaintenanceAssistantText);
  const lifts = [
    client.liftNumber,
    ...(client.liftNumbers || []),
    ...(client.addresses || []).flatMap((address) =>
      (address.lifts || []).map((lift) => lift.serialNumber || lift.label || "")
    ),
  ]
    .filter(Boolean)
    .map(normalizeMaintenanceAssistantText);
  const addresses = [
    client.address,
    ...(client.addresses || []).map((address) => address.label || address.street || ""),
  ]
    .filter(Boolean)
    .map(normalizeMaintenanceAssistantText);
  const fullText = normalizeMaintenanceAssistantText(
    [client.name, client.address, ...lifts, ...addresses].filter(Boolean).join(" ")
  );
  const tokens = new Set(tokenizeMaintenanceAssistantText(fullText));
  return { client, names, lifts, addresses, fullText, tokens };
}

function tokenMatchesProfile(profile: ReturnType<typeof createSearchProfile>, token: string) {
  return (
    profile.tokens.has(token) ||
    profile.fullText.includes(token) ||
    tokenMatches(profile.fullText, token)
  );
}

function findMatches(clients: MaintenanceClient[], clientQuery: string) {
  const needle = normalizeMaintenanceAssistantText(clientQuery);
  const queryTokens = tokenizeMaintenanceAssistantText(clientQuery);
  if (!needle || queryTokens.length === 0) return [];

  const matches = clients.map(createSearchProfile).filter((profile) => {
    const direct =
      profile.names.includes(needle) ||
      profile.lifts.includes(needle) ||
      profile.addresses.includes(needle) ||
      profile.fullText.includes(needle);
    return direct || queryTokens.every((token) => tokenMatchesProfile(profile, token));
  });

  return matches.sort((left, right) => {
    const score = (profile: (typeof matches)[number]) => {
      let total = 0;
      if (
        profile.names.includes(needle) ||
        profile.lifts.includes(needle) ||
        profile.addresses.includes(needle)
      ) {
        total += 100;
      }
      if (profile.fullText.includes(needle)) total += 20;
      total += queryTokens.filter((token) => tokenMatchesProfile(profile, token)).length * 5;
      if (profile.names.some((name) => queryTokens.some((token) => tokenMatches(name, token)))) {
        total += 3;
      }
      if (
        [...profile.addresses, ...profile.lifts].some((text) =>
          queryTokens.some((token) => tokenMatches(text, token))
        )
      ) {
        total += 3;
      }
      return total;
    };
    return score(right) - score(left);
  });
}

export function findMaintenanceClientsForAssistant(
  clients: MaintenanceClient[],
  clientQuery: string
) {
  return findMatches(filterActiveMaintenanceClients(clients), clientQuery).map((item) => item.client);
}

export function isExactMaintenanceClientAssistantMatch(
  client: MaintenanceClient,
  clientQuery: string
) {
  const needle = normalizeMaintenanceAssistantText(clientQuery);
  const queryTokens = tokenizeMaintenanceAssistantText(clientQuery);
  if (!needle || queryTokens.length === 0) return false;

  const profile = createSearchProfile(client);
  if ([...profile.names, ...profile.lifts, ...profile.addresses].includes(needle)) return true;
  if (queryTokens.length < 2) return false;

  const exactTokenMatch = (text: string, token: string) =>
    text.split(" ").includes(token) || text.includes(token);
  const nameHasToken = profile.names.some((name) =>
    queryTokens.some((token) => exactTokenMatch(name, token))
  );
  const allTokensInName = profile.names.some((name) =>
    queryTokens.every((token) => exactTokenMatch(name, token))
  );
  const locationHasToken = [...profile.addresses, ...profile.lifts].some((text) =>
    queryTokens.some((token) => exactTokenMatch(text, token))
  );
  const allTokensFound = queryTokens.every(
    (token) => profile.tokens.has(token) || profile.fullText.includes(token)
  );
  return allTokensFound && (allTokensInName || (nameHasToken && locationHasToken));
}

export function resolveAssistantAddressLiftForClient(
  client: MaintenanceClient,
  clientQuery: string
) {
  const needle = normalizeMaintenanceAssistantText(clientQuery);
  const queryTokens = tokenizeMaintenanceAssistantText(clientQuery);
  if (!needle || queryTokens.length === 0) return { address: "", lift: "" };

  const scoredGroups = buildAddressLiftGroups(client)
    .map((group) => {
      const addressText = normalizeMaintenanceAssistantText(group.address);
      const lifts = group.lifts.map((lift) => ({
        value: lift,
        text: normalizeMaintenanceAssistantText(lift),
      }));
      const fullText = normalizeMaintenanceAssistantText([group.address, ...group.lifts].join(" "));
      let score = 0;
      if (fullText.includes(needle)) score += 30;
      score += queryTokens.filter((token) => tokenMatches(fullText, token)).length * 10;
      if (queryTokens.some((token) => tokenMatches(addressText, token))) score += 8;
      if (lifts.some((lift) => queryTokens.some((token) => tokenMatches(lift.text, token)))) {
        score += 12;
      }
      const exactLift = lifts.find(
        (lift) => lift.text === needle || queryTokens.some((token) => lift.text === token)
      );
      return {
        group,
        score,
        lift: exactLift?.value || (lifts.length === 1 ? lifts[0]?.value || "" : ""),
      };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);

  const best = scoredGroups[0];
  if (!best || (scoredGroups[1] && scoredGroups[1].score === best.score)) {
    return { address: "", lift: "" };
  }
  return { address: best.group.address === "-" ? "" : best.group.address, lift: best.lift };
}
