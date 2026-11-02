import { POKEMON, pokemonDisplayName } from "../../data/pokemon";

const CARD_QUERY = `
  query CardsByPokemon($dexId: Int!, $name: String!) {
    dexCards: cards(filters: { dexId: $dexId }) {
      id
      localId
      name
      category
      image
      rarity
      illustrator
      set {
        id
        name
        releaseDate
      }
    }
    namedCards: cards(filters: { name: $name }) {
      id
      localId
      name
      category
      image
      rarity
      illustrator
      set {
        id
        name
        releaseDate
      }
    }
  }
`;

type CardForm = "standard" | "mega" | "regional" | "paired" | "special";

type GraphCard = {
  id: string;
  localId: string;
  name: string;
  category?: string | null;
  image?: string | null;
  rarity?: string | null;
  illustrator?: string | null;
  set: {
    id: string;
    name: string;
    releaseDate?: string | null;
  };
};

type CardBrief = {
  id: string;
  localId: string;
  name: string;
  image?: string | null;
};

type CatalogueCard = {
  id: string;
  sourceId: string;
  name: string;
  setName: string;
  setCode: string;
  number: string;
  rarity: string;
  illustrator: string | null;
  releaseDate: string | null;
  imageUrl: string | null;
  imageLargeUrl: string | null;
  language: string;
  form: CardForm;
  formLabel: string;
};

function imageUrl(base: string | null | undefined, quality: "low" | "high") {
  return base ? `${base}/${quality}.webp` : null;
}

function setCodeFromCardId(cardId: string) {
  const divider = cardId.lastIndexOf("-");
  return divider > 0 ? cardId.slice(0, divider) : cardId;
}

function normaliseName(value: string) {
  return value
    .replace(/♀/g, " female ")
    .replace(/♂/g, " male ")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function nameIncludesPokemon(cardName: string, pokemonName: string) {
  const card = normaliseName(cardName);
  const pokemon = normaliseName(pokemonName);
  return card === pokemon || card.startsWith(`${pokemon} `) || card.endsWith(` ${pokemon}`) || card.includes(` ${pokemon} `);
}

function cardClassification(cardName: string, pokemonName: string): { form: CardForm; formLabel: string } {
  const card = normaliseName(cardName);
  const pokemon = normaliseName(pokemonName);

  if (
    card === `mega ${pokemon}` ||
    card.startsWith(`mega ${pokemon} `) ||
    card === `m ${pokemon}` ||
    card.startsWith(`m ${pokemon} `)
  ) {
    return { form: "mega", formLabel: "Mega Evolution" };
  }

  const regionalForm = ["alolan", "galarian", "hisuian", "paldean"].find(
    (region) => card === `${region} ${pokemon}` || card.startsWith(`${region} ${pokemon} `),
  );
  if (regionalForm) {
    return {
      form: "regional",
      formLabel: `${regionalForm.charAt(0).toUpperCase()}${regionalForm.slice(1)} Form`,
    };
  }

  if (cardName.includes("&")) return { form: "paired", formLabel: "Paired Pokémon" };
  if (card === pokemon || card.startsWith(`${pokemon} `)) return { form: "standard", formLabel: "Base Species" };
  return { form: "special", formLabel: "Special Version" };
}

function sortCards<T extends { imageUrl: string | null; releaseDate: string | null; setName: string; number: string }>(cards: T[]) {
  return cards.sort((first, second) => {
    const dated = (second.releaseDate ?? "").localeCompare(first.releaseDate ?? "");
    if (dated) return dated;
    if (Boolean(first.imageUrl) !== Boolean(second.imageUrl)) return first.imageUrl ? -1 : 1;
    const setOrder = first.setName.localeCompare(second.setName);
    return setOrder || first.number.localeCompare(second.number, undefined, { numeric: true });
  });
}

function fromGraphCard(card: GraphCard, pokemonName: string): CatalogueCard {
  const classification = cardClassification(card.name, pokemonName);
  return {
    id: `tcgdex:${card.id}`,
    sourceId: card.id,
    name: card.name,
    setName: card.set.name,
    setCode: card.set.id,
    number: card.localId,
    rarity: card.rarity || "Unlisted rarity",
    illustrator: card.illustrator ?? null,
    releaseDate: card.set.releaseDate ?? null,
    imageUrl: imageUrl(card.image, "low"),
    imageLargeUrl: imageUrl(card.image, "high"),
    language: "Artwork reference",
    ...classification,
  };
}

function fromBriefCard(card: CardBrief, pokemonName: string): CatalogueCard {
  const setCode = setCodeFromCardId(card.id);
  const classification = cardClassification(card.name, pokemonName);
  return {
    id: `tcgdex:${card.id}`,
    sourceId: card.id,
    name: card.name,
    setName: setCode,
    setCode,
    number: card.localId,
    rarity: "Catalogue card",
    illustrator: null,
    releaseDate: null,
    imageUrl: imageUrl(card.image, "low"),
    imageLargeUrl: imageUrl(card.image, "high"),
    language: "Artwork reference",
    ...classification,
  };
}

function mergeCatalogues(...catalogues: CatalogueCard[][]) {
  const cards = new Map<string, CatalogueCard>();
  for (const catalogue of catalogues) {
    for (const card of catalogue) cards.set(card.sourceId, card);
  }
  return [...cards.values()];
}

async function namedPokemonCatalogue(pokemonName: string) {
  const response = await fetch(
    `https://api.tcgdex.net/v2/en/cards?name=${encodeURIComponent(pokemonName)}&category=Pokemon`,
  );
  if (!response.ok) throw new Error("The alternate-form catalogue did not respond.");

  const cards = (await response.json()) as CardBrief[];
  return cards
    .filter((card) => nameIncludesPokemon(card.name, pokemonName))
    .map((card) => fromBriefCard(card, pokemonName));
}

async function expandedCatalogue(pokemonId: number, pokemonName: string) {
  const response = await fetch("https://api.tcgdex.net/v2/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: CARD_QUERY, variables: { dexId: pokemonId, name: pokemonName } }),
  });

  if (!response.ok) throw new Error("The expanded card catalogue did not respond.");

  const payload = (await response.json()) as {
    data?: { dexCards?: GraphCard[]; namedCards?: GraphCard[] };
    errors?: Array<{ message?: string }>;
  };

  if (payload.errors?.length && !payload.data?.dexCards) {
    throw new Error(payload.errors[0]?.message ?? "The expanded card catalogue returned an error.");
  }

  const dexCards = (payload.data?.dexCards ?? [])
    .filter((card) => !card.category || card.category === "Pokemon")
    .map((card) => fromGraphCard(card, pokemonName));
  const namedCards = (payload.data?.namedCards ?? [])
    .filter((card) => card.category === "Pokemon" && nameIncludesPokemon(card.name, pokemonName))
    .map((card) => fromGraphCard(card, pokemonName));
  return sortCards(mergeCatalogues(dexCards, namedCards));
}

async function catalogueFallback(pokemonId: number, pokemonName: string) {
  const [response, namedCards] = await Promise.all([
    fetch(`https://api.tcgdex.net/v2/en/cards?dexId=eq:${pokemonId}`),
    namedPokemonCatalogue(pokemonName).catch(() => []),
  ]);

  if (!response.ok) throw new Error("The card catalogue did not respond.");

  const cards = (await response.json()) as CardBrief[];
  const dexCards = cards.map((card) => fromBriefCard(card, pokemonName));
  return sortCards(mergeCatalogues(dexCards, namedCards));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const pokemonId = Number(url.searchParams.get("pokemonId"));
  const pokemon = POKEMON.find((entry) => entry.id === pokemonId);

  if (!Number.isInteger(pokemonId) || !pokemon) {
    return Response.json({ error: "Invalid Pokédex number." }, { status: 400 });
  }

  const pokemonName = pokemonDisplayName(pokemon.slug);

  try {
    let cards: CatalogueCard[];
    let catalogue = "expanded";

    try {
      cards = await expandedCatalogue(pokemonId, pokemonName);
    } catch {
      cards = await catalogueFallback(pokemonId, pokemonName);
      catalogue = "fallback";
    }

    const megaCount = cards.filter((card) => card.form === "mega").length;
    const alternateCount = cards.filter((card) => card.form !== "standard").length;
    const formCoverage = alternateCount
      ? ` ${alternateCount} alternate-form artwork${alternateCount === 1 ? " is" : "s are"} grouped under ${pokemonName}${megaCount ? `, including ${megaCount} Mega Evolution card${megaCount === 1 ? "" : "s"}` : ""}.`
      : "";

    return Response.json(
      {
        cards,
        catalogue,
        megaCount,
        alternateCount,
        coverage:
          catalogue === "expanded"
            ? `Expanded master catalogue: ${cards.length} known printings, including regular cards, illustration rares, promos and special releases.${formCoverage}`
            : `Master catalogue fallback: ${cards.length} known printings.${formCoverage} Some set and rarity details are temporarily unavailable.`,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
        },
      },
    );
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Card search failed.",
        cards: [],
        coverage: "The live catalogue is temporarily unavailable. You can still save an unlisted card.",
      },
      { status: 502 },
    );
  }
}
