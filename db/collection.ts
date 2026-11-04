/** Validation shared by the ChatGPT-account and sync-code collection routes. */
export const MAX_COLLECTION_BYTES = 2_000_000;
const MAX_POKEMON_ID = 1025;
const LANGUAGES = new Set(["English", "Japanese", "Chinese", "Korean"]);
const CARD_FORMS = new Set(["standard", "mega", "regional", "paired", "special"]);

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value: unknown, maximumLength: number) {
  return typeof value === "string" && value.length <= maximumLength ? value : null;
}

function cleanOptionalString(value: unknown, maximumLength: number) {
  if (value === null || value === undefined) return null;
  return cleanString(value, maximumLength);
}

function cleanImageUrl(value: unknown) {
  if (value === null || value === undefined) return null;
  const candidate = cleanString(value, 2048);
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? candidate : null;
  } catch {
    return null;
  }
}

function normaliseCard(value: unknown) {
  if (!isRecord(value)) return undefined;

  const id = cleanString(value.id, 256);
  const sourceId = cleanString(value.sourceId, 256);
  const name = cleanString(value.name, 300);
  const setName = cleanString(value.setName, 300);
  const setCode = cleanString(value.setCode, 100);
  const number = cleanString(value.number, 100);
  const rarity = cleanString(value.rarity, 160);
  const language = cleanString(value.language, 80);
  if (!id || !sourceId || !name || !setName || !setCode || !number || !rarity || !language) {
    return undefined;
  }

  const form = CARD_FORMS.has(String(value.form)) ? String(value.form) : undefined;
  const formLabel = cleanOptionalString(value.formLabel, 120);

  return {
    id,
    sourceId,
    name,
    setName,
    setCode,
    number,
    rarity,
    imageUrl: cleanImageUrl(value.imageUrl),
    imageLargeUrl: cleanImageUrl(value.imageLargeUrl),
    illustrator: cleanOptionalString(value.illustrator, 200),
    releaseDate: cleanOptionalString(value.releaseDate, 40),
    language,
    ...(form ? { form } : {}),
    ...(formLabel ? { formLabel } : {}),
  };
}

function normaliseOwnedCard(value: unknown) {
  if (!isRecord(value)) return null;

  const cardId = cleanString(value.cardId, 256);
  const language = cleanString(value.language, 40);
  const acquiredAt = cleanString(value.acquiredAt, 64);
  if (!cardId || !language || !LANGUAGES.has(language) || !acquiredAt || Number.isNaN(Date.parse(acquiredAt))) {
    return null;
  }

  const card = value.card === undefined ? undefined : normaliseCard(value.card);
  if (value.card !== undefined && !card) return null;

  return {
    cardId,
    language,
    acquiredAt,
    ...(card ? { card } : {}),
  };
}

export function normaliseCollection(value: unknown) {
  if (!isRecord(value)) return null;

  const collection: Record<string, ReturnType<typeof normaliseOwnedCard>> = {};
  const entries = Object.entries(value);
  if (entries.length > MAX_POKEMON_ID) return null;

  for (const [key, rawOwnedCard] of entries) {
    const pokemonId = Number(key);
    if (!Number.isInteger(pokemonId) || pokemonId < 1 || pokemonId > MAX_POKEMON_ID) return null;

    const ownedCard = normaliseOwnedCard(rawOwnedCard);
    if (!ownedCard) return null;
    collection[String(pokemonId)] = ownedCard;
  }

  return collection;
}
