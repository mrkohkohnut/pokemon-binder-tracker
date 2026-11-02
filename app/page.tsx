"use client";

import { useEffect, useMemo, useState } from "react";
import { POKEMON, pokemonDisplayName } from "./data/pokemon";

type Language = "English" | "Japanese" | "Chinese" | "Korean";
type CollectionFilter = "all" | "collected" | "missing";
type CardForm = "standard" | "mega" | "regional" | "paired" | "special";
type CatalogueFilter = "all" | "forms" | "mega" | "art" | "promo" | "pictured";
type SyncMode = "checking" | "local" | "cloud" | "error";
type SyncState = "idle" | "saving" | "synced" | "error";

type CardOption = {
  id: string;
  sourceId: string;
  name: string;
  setName: string;
  setCode: string;
  number: string;
  rarity: string;
  imageUrl: string | null;
  imageLargeUrl: string | null;
  illustrator?: string | null;
  releaseDate?: string | null;
  language: string;
  form?: CardForm;
  formLabel?: string;
};

type OwnedCard = {
  cardId: string;
  language: Language;
  acquiredAt: string;
  card?: CardOption;
};

type CollectionState = Record<number, OwnedCard>;

type SyncUser = {
  id: string;
  displayName: string;
};

type CollectionResponse = {
  authenticated?: boolean;
  user?: SyncUser;
  collection?: CollectionState;
  error?: string;
};

const LOCAL_STORAGE_KEY = "pokemon-binder-tracker-v1";
const USER_CACHE_PREFIX = "pokemon-binder-tracker-v1:cloud:";
const USER_DIRTY_PREFIX = "pokemon-binder-tracker-v1:dirty:";
const USER_MIGRATED_PREFIX = "pokemon-binder-tracker-v1:migrated:";
const PAGE_SIZE = 16;
const CATALOGUE_BATCH = 36;
const LANGUAGES: Language[] = ["English", "Japanese", "Chinese", "Korean"];

const GENERATIONS = [
  { id: "all", label: "All regions", start: 1, end: 1025 },
  { id: "kanto", label: "Kanto · Gen I", start: 1, end: 151 },
  { id: "johto", label: "Johto · Gen II", start: 152, end: 251 },
  { id: "hoenn", label: "Hoenn · Gen III", start: 252, end: 386 },
  { id: "sinnoh", label: "Sinnoh · Gen IV", start: 387, end: 493 },
  { id: "unova", label: "Unova · Gen V", start: 494, end: 649 },
  { id: "kalos", label: "Kalos · Gen VI", start: 650, end: 721 },
  { id: "alola", label: "Alola · Gen VII", start: 722, end: 809 },
  { id: "galar", label: "Galar · Gen VIII", start: 810, end: 905 },
  { id: "paldea", label: "Paldea · Gen IX", start: 906, end: 1025 },
] as const;

function supportedLanguage(language?: string): Language {
  return LANGUAGES.includes(language as Language) ? (language as Language) : "English";
}

function formatDex(id: number) {
  return `#${String(id).padStart(4, "0")}`;
}

function spriteUrl(id: number) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;
}

function loadCollection(storageKey: string): CollectionState {
  if (typeof window === "undefined") return {};
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}") as CollectionState;
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

function collectionsMatch(first: CollectionState, second: CollectionState) {
  return JSON.stringify(first) === JSON.stringify(second);
}

function isArtRarity(rarity: string) {
  const value = rarity.toLowerCase();
  return ["illustration", "character", "secret", "hyper", "ultra rare", "shiny", "amazing", "crown"].some((term) => value.includes(term));
}

export default function Home() {
  const [collection, setCollection] = useState<CollectionState>({});
  const [hydrated, setHydrated] = useState(false);
  const [syncMode, setSyncMode] = useState<SyncMode>("checking");
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [syncUser, setSyncUser] = useState<SyncUser | null>(null);
  const [activeStorageKey, setActiveStorageKey] = useState(LOCAL_STORAGE_KEY);
  const [syncRetry, setSyncRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<CollectionFilter>("all");
  const [language, setLanguage] = useState<"all" | Language>("all");
  const [generation, setGeneration] = useState<(typeof GENERATIONS)[number]["id"]>("all");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(1);
  const [cardLanguage, setCardLanguage] = useState<Language>("English");
  const [cards, setCards] = useState<CardOption[]>([]);
  const [draftCardId, setDraftCardId] = useState<string | null>(null);
  const [cardLoading, setCardLoading] = useState(true);
  const [cardError, setCardError] = useState("");
  const [coverage, setCoverage] = useState("");
  const [catalogueQuery, setCatalogueQuery] = useState("");
  const [catalogueFilter, setCatalogueFilter] = useState<CatalogueFilter>("all");
  const [catalogueLimit, setCatalogueLimit] = useState(CATALOGUE_BATCH);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function initialiseCollection() {
      const localCollection = loadCollection(LOCAL_STORAGE_KEY);

      try {
        const response = await fetch("/api/collection", { cache: "no-store" });
        if (response.status === 401) {
          if (!cancelled) {
            setCollection(localCollection);
            setSyncMode("local");
            setSyncState("idle");
          }
          return;
        }

        const data = (await response.json()) as CollectionResponse;
        if (!data.authenticated || !data.user) {
          throw new Error(data.error ?? "Cloud sync is unavailable.");
        }

        const userCacheKey = `${USER_CACHE_PREFIX}${data.user.id}`;
        const dirtyKey = `${USER_DIRTY_PREFIX}${data.user.id}`;
        const migratedKey = `${USER_MIGRATED_PREFIX}${data.user.id}`;
        const userCache = loadCollection(userCacheKey);
        if (!response.ok) {
          if (!cancelled) {
            setActiveStorageKey(userCacheKey);
            setCollection(userCache);
            setSyncUser(data.user);
            setSyncMode("error");
            setSyncState("error");
          }
          return;
        }

        const remoteCollection = data.collection ?? {};
        const hasPendingDeviceChanges = window.localStorage.getItem(dirtyKey) === "1";
        const hasMigratedLocalCollection = window.localStorage.getItem(migratedKey) === "1";
        const resolvedCollection = hasPendingDeviceChanges
          ? userCache
          : hasMigratedLocalCollection
            ? remoteCollection
            : { ...remoteCollection, ...localCollection };

        if (!cancelled) {
          setActiveStorageKey(userCacheKey);
          setCollection(resolvedCollection);
          setSyncUser(data.user);
          setSyncMode("cloud");
          setSyncState("synced");
        }
      } catch {
        if (!cancelled) {
          setCollection(localCollection);
          setSyncMode("error");
          setSyncState("error");
        }
      } finally {
        if (!cancelled) setHydrated(true);
      }
    }

    void initialiseCollection();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(activeStorageKey, JSON.stringify(collection));
    if (syncMode !== "cloud" || !syncUser) return;

    const controller = new AbortController();
    const dirtyKey = `${USER_DIRTY_PREFIX}${syncUser.id}`;
    const migratedKey = `${USER_MIGRATED_PREFIX}${syncUser.id}`;
    window.localStorage.setItem(dirtyKey, "1");

    const saveTimer = window.setTimeout(async () => {
      setSyncState("saving");
      try {
        const response = await fetch("/api/collection", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ collection }),
          signal: controller.signal,
        });
        const data = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Cloud sync failed.");

        window.localStorage.removeItem(LOCAL_STORAGE_KEY);
        window.localStorage.removeItem(dirtyKey);
        window.localStorage.setItem(migratedKey, "1");
        setSyncState("synced");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSyncState("error");
      }
    }, 250);

    return () => {
      window.clearTimeout(saveTimer);
      controller.abort();
    };
  }, [activeStorageKey, collection, hydrated, syncMode, syncRetry, syncUser]);

  useEffect(() => {
    if (syncMode !== "cloud" || !syncUser) return;

    async function refreshFromCloud() {
      const dirtyKey = `${USER_DIRTY_PREFIX}${syncUser.id}`;
      if (window.localStorage.getItem(dirtyKey) === "1") return;

      try {
        const response = await fetch("/api/collection", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as CollectionResponse;
        const remoteCollection = data.collection ?? {};
        setCollection((current) => collectionsMatch(current, remoteCollection) ? current : remoteCollection);
      } catch {
        // Keep the local cache; the next focus or page load will retry.
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void refreshFromCloud();
    };
    window.addEventListener("focus", refreshFromCloud);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", refreshFromCloud);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [syncMode, syncUser]);

  const pokemonWithNames = useMemo(
    () => POKEMON.map((pokemon) => ({ ...pokemon, name: pokemonDisplayName(pokemon.slug) })),
    [],
  );
  const selected = pokemonWithNames.find((pokemon) => pokemon.id === selectedId) ?? pokemonWithNames[0];
  const selectedOwned = collection[selected.id];

  useEffect(() => {
    setCardLanguage(supportedLanguage(selectedOwned?.language));
    setDraftCardId(selectedOwned?.cardId ?? null);
    setCatalogueQuery("");
    setCatalogueFilter("all");
    setCatalogueLimit(CATALOGUE_BATCH);
    setNotice("");
  }, [selected.id, selectedOwned?.cardId, selectedOwned?.language]);

  useEffect(() => {
    const controller = new AbortController();
    setCardLoading(true);
    setCardError("");
    setCoverage("");

    fetch(`/api/cards?pokemonId=${selected.id}`, { signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json()) as { cards?: CardOption[]; coverage?: string; error?: string };
        if (!response.ok && !data.cards?.length) throw new Error(data.error ?? "Could not load cards.");
        return data;
      })
      .then((data) => {
        setCards(data.cards ?? []);
        setCoverage(data.coverage ?? "");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setCards([]);
        setCardError(error instanceof Error ? error.message : "Could not load cards.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setCardLoading(false);
      });

    return () => controller.abort();
  }, [selected.id]);

  const activeGeneration = GENERATIONS.find((item) => item.id === generation) ?? GENERATIONS[0];
  const filtered = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase().replace(/^#/, "");
    return pokemonWithNames.filter((pokemon) => {
      const owned = collection[pokemon.id];
      return (
        pokemon.id >= activeGeneration.start &&
        pokemon.id <= activeGeneration.end &&
        (!cleanQuery ||
          pokemon.name.toLowerCase().includes(cleanQuery) ||
          String(pokemon.id).includes(cleanQuery) ||
          String(pokemon.id).padStart(4, "0").includes(cleanQuery)) &&
        (status === "all" || (status === "collected" ? Boolean(owned) : !owned)) &&
        (language === "all" || owned?.language === language)
      );
    });
  }, [activeGeneration.end, activeGeneration.start, collection, language, pokemonWithNames, query, status]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagePokemon = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    if (safePage !== page) setPage(safePage);
  }, [page, safePage]);

  const baseCard: CardOption = {
    id: `base:${selected.id}`,
    sourceId: `base-${selected.id}`,
    name: `${selected.name} · unlisted card`,
    setName: "Any printing in your binder",
    setCode: "OWN",
    number: formatDex(selected.id),
    rarity: "Manual entry",
    imageUrl: null,
    imageLargeUrl: null,
    releaseDate: null,
    illustrator: null,
    language: cardLanguage,
    form: "standard",
    formLabel: "Base Species",
  };

  const legacyCard = selectedOwned?.card && !cards.some((card) => card.id === selectedOwned.cardId) ? selectedOwned.card : null;
  const selectableCards = legacyCard ? [legacyCard, ...cards] : cards;
  const allChoices = [baseCard, ...selectableCards];
  const draftCard = allChoices.find((card) => card.id === draftCardId) ?? selectableCards[0] ?? baseCard;

  const catalogueCards = useMemo(() => {
    const cleanQuery = catalogueQuery.trim().toLowerCase();
    const matchingCards = selectableCards.filter((card) => {
      const matchesSearch =
        !cleanQuery ||
        [card.name, card.setName, card.setCode, card.number, card.rarity].some((value) => value.toLowerCase().includes(cleanQuery));
      const rarity = card.rarity.toLowerCase();
      const matchesFilter =
        catalogueFilter === "all" ||
        (catalogueFilter === "forms" && Boolean(card.form && card.form !== "standard")) ||
        (catalogueFilter === "mega" && card.form === "mega") ||
        (catalogueFilter === "art" && isArtRarity(card.rarity)) ||
        (catalogueFilter === "promo" && (rarity.includes("promo") || card.setName.toLowerCase().includes("promo"))) ||
        (catalogueFilter === "pictured" && Boolean(card.imageUrl));
      return matchesSearch && matchesFilter;
    });

    if (catalogueFilter !== "all") return matchingCards;
    const formOrder: Array<CardForm | undefined> = ["mega", "regional", "paired", "special", "standard", undefined];
    return formOrder.flatMap((form) => matchingCards.filter((card) => card.form === form));
  }, [catalogueFilter, catalogueQuery, selectableCards]);

  const megaCount = useMemo(() => selectableCards.filter((card) => card.form === "mega").length, [selectableCards]);
  const alternateCount = useMemo(
    () => selectableCards.filter((card) => card.form && card.form !== "standard").length,
    [selectableCards],
  );

  const collectedCount = Object.keys(collection).length;
  const remainingCount = POKEMON.length - collectedCount;
  const progress = Math.round((collectedCount / POKEMON.length) * 1000) / 10;

  function saveChosenCard() {
    if (!draftCard) return;
    setCollection((current) => ({
      ...current,
      [selected.id]: {
        cardId: draftCard.id,
        language: cardLanguage,
        acquiredAt: current[selected.id]?.acquiredAt ?? new Date().toISOString(),
        card: { ...draftCard, language: cardLanguage },
      },
    }));
    setNotice(`${selected.name} was added to your binder.${syncMode === "cloud" ? " Syncing to your account…" : ""}`);
  }

  function markMissing() {
    setCollection((current) => {
      const next = { ...current };
      delete next[selected.id];
      return next;
    });
    setNotice(`${selected.name} is marked as missing.${syncMode === "cloud" ? " Syncing to your account…" : ""}`);
  }

  function chooseGeneration(nextGeneration: (typeof GENERATIONS)[number]["id"]) {
    const next = GENERATIONS.find((item) => item.id === nextGeneration) ?? GENERATIONS[0];
    setGeneration(nextGeneration);
    setPage(1);
    if (nextGeneration !== "all") setSelectedId(next.start);
  }

  return (
    <main className="tracker-shell">
      <header className="hero" aria-label="Collection overview">
        <div className="hero-console">
          <div className="console-row">
            <div className="console-lights" aria-hidden="true"><span className="lens" /><span /><span /><span /></div>
            <div className={`sync-console ${syncMode} ${syncState}`} aria-live="polite">
              <span className="sync-light" aria-hidden="true" />
              <div>
                {syncMode === "checking" && <><strong>Checking cloud save</strong><small>Loading your binder…</small></>}
                {syncMode === "local" && <><strong>Device-only binder</strong><small>Sign in to use it everywhere</small></>}
                {syncMode === "error" && <><strong>Cloud unavailable</strong><small>Your device copy is safe</small></>}
                {syncMode === "cloud" && (
                  <>
                    <strong>{syncState === "saving" ? "Saving to cloud…" : syncState === "error" ? "Saved on this device" : "Cloud synced"}</strong>
                    <small>{syncUser?.displayName ?? "Signed-in trainer"}</small>
                  </>
                )}
              </div>
              {syncMode === "local" && <a href="/signin-with-chatgpt?return_to=%2F">Sync devices</a>}
              {syncMode === "error" && <button type="button" onClick={() => window.location.reload()}>Retry</button>}
              {syncMode === "cloud" && syncState === "error" && <button type="button" onClick={() => setSyncRetry((value) => value + 1)}>Retry</button>}
              {syncMode === "cloud" && syncState !== "error" && <a href="/signout-with-chatgpt?return_to=%2F">Sign out</a>}
            </div>
          </div>
          <div className="brand-lockup">
            <span className="pokeball-logo" aria-hidden="true" />
            <div>
              <p className="eyebrow">Trainer’s National Pokédex</p>
              <h1>Poké Binder</h1>
              <p>Choose one favourite printing for every Pokémon—with Mega Evolutions, regional forms, paired cards and every named version grouped under its base Pokémon.</p>
            </div>
          </div>
        </div>

        <div className="hero-progress">
          <div className="mascot-stack" aria-hidden="true">
            <img src={spriteUrl(25)} alt="" />
            <img src={spriteUrl(133)} alt="" />
          </div>
          <div className="progress-orb" style={{ background: `conic-gradient(#ffcb05 ${progress}%, rgba(255,255,255,.16) 0)` }}>
            <div><strong>{progress}%</strong><span>complete</span></div>
          </div>
          <div className="progress-copy">
            <span>Binder progress</span>
            <strong>{collectedCount.toLocaleString()} / {POKEMON.length.toLocaleString()}</strong>
            <small>{remainingCount.toLocaleString()} Pokémon still to catch</small>
          </div>
        </div>
      </header>

      <section className="trainer-stats" aria-label="Collection statistics">
        <div><span className="mini-pokeball" aria-hidden="true" /><p><strong>{collectedCount.toLocaleString()}</strong><span>Collected</span></p></div>
        <div><span className="stat-spark" aria-hidden="true">✦</span><p><strong>{remainingCount.toLocaleString()}</strong><span>Missing</span></p></div>
        <div><span className="stat-badge" aria-hidden="true">9</span><p><strong>All regions</strong><span>Kanto to Paldea</span></p></div>
      </section>

      <section className="controls" aria-label="Search and filters">
        <label className="search-control">
          <span>Find a Pokémon</span>
          <div className="input-shell"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Name or Pokédex number" /></div>
        </label>
        <div className="filter-control">
          <span>Binder status</span>
          <div className="segmented" role="group" aria-label="Filter by binder status">
            {(["all", "collected", "missing"] as const).map((value) => (
              <button key={value} type="button" className={status === value ? "active" : ""} onClick={() => { setStatus(value); setPage(1); }}>
                {value === "all" ? "All" : value === "collected" ? "Caught" : "Missing"}
              </button>
            ))}
          </div>
        </div>
        <label><span>Region</span><select value={generation} onChange={(event) => chooseGeneration(event.target.value as (typeof GENERATIONS)[number]["id"])}>{GENERATIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label><span>Card language</span><select value={language} onChange={(event) => { setLanguage(event.target.value as typeof language); setPage(1); }}><option value="all">Any language</option>{LANGUAGES.map((item) => <option key={item}>{item}</option>)}</select></label>
      </section>

      <section className="workspace">
        <section className="binder" aria-label="Pokémon binder">
          <div className="binder-spine" aria-hidden="true"><span /><span /><span /><span /></div>
          <div className="binder-header">
            <div><span className="case-chip"><span className="mini-pokeball" /> National Dex case</span><small>{filtered.length.toLocaleString()} Pokémon in this view</small></div>
            <div className="page-nav">
              <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={safePage === 1} aria-label="Previous binder page">‹</button>
              <p><span>Page</span><strong>{safePage}</strong><small>of {totalPages}</small></p>
              <button type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={safePage === totalPages} aria-label="Next binder page">›</button>
            </div>
          </div>

          <div className="binder-grid">
            {pagePokemon.length === 0 && <div className="binder-empty"><span className="pokeball-logo" aria-hidden="true" /><strong>No Pokémon found</strong><p>Try a different name, region, or binder filter.</p></div>}
            {pagePokemon.map((pokemon) => {
              const owned = collection[pokemon.id];
              const ownedImage = owned?.card?.imageUrl;
              return (
                <button type="button" key={pokemon.id} className={`pocket ${owned ? "owned" : "missing"} ${selected.id === pokemon.id ? "active" : ""}`} onClick={() => setSelectedId(pokemon.id)} aria-label={`${pokemon.name}, ${owned ? "collected" : "missing"}`}>
                  <span className="dex">{formatDex(pokemon.id)}</span>
                  <span className="pocket-status" aria-hidden="true">{owned ? "✓" : ""}</span>
                  <span className="pocket-art">
                    {ownedImage ? <img className="owned-card-art" src={ownedImage} alt="" loading="lazy" /> : <img className="pokemon-sprite" src={spriteUrl(pokemon.id)} alt="" loading="lazy" />}
                    {ownedImage && <img className="sprite-stamp" src={spriteUrl(pokemon.id)} alt="" loading="lazy" />}
                  </span>
                  <strong>{pokemon.name}</strong>
                  <small>{owned ? `${owned.language} · ${owned.card?.setCode ?? "Saved"}` : "Open pocket"}</small>
                </button>
              );
            })}
            {pagePokemon.length > 0 && Array.from({ length: PAGE_SIZE - pagePokemon.length }).map((_, index) => <div className="pocket empty" key={`empty-${index}`} aria-hidden="true" />)}
          </div>
        </section>

        <aside className="card-station" aria-label="Card selection station">
          <div className="station-topbar"><div><span /><span /><span /></div><p>Card Scan Station</p><span className={`status-pill ${selectedOwned ? "owned" : "missing"}`}>{selectedOwned ? "In binder" : "Missing"}</span></div>

          <div className="pokemon-identity">
            <div className="sprite-frame"><img src={spriteUrl(selected.id)} alt={`${selected.name} sprite`} /></div>
            <div>
              <span>{formatDex(selected.id)}</span>
              <h2>{selected.name}</h2>
              <p>{selectedOwned ? `${selectedOwned.card?.name ?? "Chosen card"} · ${selectedOwned.language}` : "Pick the exact printing that belongs in this pocket."}</p>
              {alternateCount > 0 && <div className="identity-forms"><b>FORMS</b><span>{alternateCount} alternate version{alternateCount === 1 ? "" : "s"} grouped here</span></div>}
            </div>
          </div>

          <label className="language-choice"><span>Language printed on your card</span><select value={cardLanguage} onChange={(event) => setCardLanguage(event.target.value as Language)}>{LANGUAGES.map((item) => <option key={item}>{item}</option>)}</select></label>

          <section className="chosen-card" aria-label="Current card choice">
            <div className={`preview-art ${draftCard.id.startsWith("base:") ? "base-preview" : ""}`}>
              {draftCard.imageLargeUrl || draftCard.imageUrl ? (
                <img src={draftCard.imageLargeUrl ?? draftCard.imageUrl ?? ""} alt={`${draftCard.name}, ${draftCard.setName} ${draftCard.number}`} />
              ) : (
                <div className="manual-card-face"><span className="pokeball-logo" aria-hidden="true" /><strong>YOUR CARD</strong><img src={spriteUrl(selected.id)} alt="" /><small>{selected.name}</small></div>
              )}
            </div>
            <div className="preview-details">
              <div className="preview-tags">
                {draftCard.form && draftCard.form !== "standard" && <span className={`form-tag ${draftCard.form}`}>{draftCard.formLabel ?? "Alternate Form"}</span>}
                <span className="rarity-tag">{draftCard.rarity}</span>
              </div>
              <h3>{draftCard.name}</h3>
              <p>{draftCard.setName}</p>
              <dl>
                <div><dt>Set</dt><dd>{draftCard.setCode}</dd></div>
                <div><dt>Number</dt><dd>{draftCard.number}</dd></div>
                <div><dt>Language</dt><dd>{cardLanguage}</dd></div>
                {draftCard.releaseDate && <div><dt>Released</dt><dd>{draftCard.releaseDate}</dd></div>}
              </dl>
            </div>
          </section>

          <section className="catalogue" aria-label="Card catalogue">
            <div className="catalogue-heading">
              <div><p>Available printings</p><h3>{cardLoading ? "Searching the Pokédex…" : `${catalogueCards.length} card${catalogueCards.length === 1 ? "" : "s"}`}</h3></div>
              <div className="catalogue-badges">
                {alternateCount > 0 && <span className="form-count">{alternateCount} Forms</span>}
                {megaCount > 0 && <span className="mega-count">{megaCount} Mega</span>}
                <span className="catalogue-count">{cards.length} total</span>
              </div>
            </div>
            <div className="catalogue-search"><span aria-hidden="true">⌕</span><input value={catalogueQuery} onChange={(event) => { setCatalogueQuery(event.target.value); setCatalogueLimit(CATALOGUE_BATCH); }} placeholder="Search set, number or rarity" aria-label="Search available card printings" /></div>
            <div className="catalogue-filters" role="group" aria-label="Filter available card printings">
              {([
                ["all", "All"],
                ...(alternateCount > 0 ? [["forms", `Forms · ${alternateCount}`] as const] : []),
                ...(megaCount > 0 ? [["mega", `Mega · ${megaCount}`] as const] : []),
                ["art", "Art rares"],
                ["promo", "Promos"],
                ["pictured", "With image"],
              ] as const).map(([value, label]) => <button type="button" key={value} className={catalogueFilter === value ? "active" : ""} onClick={() => { setCatalogueFilter(value); setCatalogueLimit(CATALOGUE_BATCH); }}>{label}</button>)}
            </div>

            <button type="button" className={`manual-option ${draftCard.id === baseCard.id ? "chosen" : ""}`} aria-pressed={draftCard.id === baseCard.id} onClick={() => setDraftCardId(baseCard.id)}>
              <span className="pokeball-logo" aria-hidden="true" /><span><strong>Can’t find your card?</strong><small>Use an unlisted or base printing</small></span><b aria-hidden="true">›</b>
            </button>

            {cardLoading && <div className="card-message"><span className="pokeball-loader" aria-hidden="true" /><strong>Loading every known printing…</strong><span>This may take a moment for Pokémon with large catalogues.</span></div>}
            {!cardLoading && cardError && <div className="card-message error"><strong>Catalogue unavailable</strong><span>{cardError} You can still save an unlisted card above.</span></div>}
            {!cardLoading && !cardError && catalogueCards.length === 0 && <div className="card-message"><strong>No matching cards</strong><span>Try “All” or clear the catalogue search.</span></div>}

            {!cardLoading && catalogueCards.length > 0 && (
              <div className="card-options">
                {catalogueCards.slice(0, catalogueLimit).map((card) => (
                  <button key={card.id} type="button" aria-pressed={draftCard.id === card.id} className={`card-choice ${card.form && card.form !== "standard" ? `variant ${card.form}` : ""} ${draftCard.id === card.id ? "chosen" : ""}`} onClick={() => setDraftCardId(card.id)}>
                    <span className="card-art">
                      {card.imageUrl ? <img src={card.imageUrl} alt={`${card.name}, ${card.setName} ${card.number}`} loading="lazy" /> : <span className="missing-art"><img src={spriteUrl(selected.id)} alt="" /><span className="mini-pokeball" /></span>}
                      {draftCard.id === card.id && <span className="choice-check" aria-hidden="true">✓</span>}
                    </span>
                    <span className="card-meta"><strong>{card.name}</strong><span>{card.setName}</span><small>{card.setCode} · {card.number}</small>{card.form && card.form !== "standard" && <b className={`form-tag ${card.form}`}>{card.formLabel ?? "Alternate Form"}</b>}<em>{card.rarity}</em></span>
                  </button>
                ))}
              </div>
            )}

            {!cardLoading && catalogueLimit < catalogueCards.length && <button type="button" className="show-more" onClick={() => setCatalogueLimit((current) => current + CATALOGUE_BATCH)}>Show {Math.min(CATALOGUE_BATCH, catalogueCards.length - catalogueLimit)} more cards</button>}
            {coverage && <p className="coverage-note">{coverage} Catalogue images are artwork references; save the language printed on your physical card separately.</p>}
          </section>

          <div className="detail-actions">
            <button type="button" className="secondary" onClick={markMissing} disabled={!selectedOwned}>Mark missing</button>
            <button type="button" className="primary" onClick={saveChosenCard}><span className="mini-pokeball" aria-hidden="true" />{selectedOwned ? "Replace card" : "Add to binder"}</button>
          </div>
          <p className="save-notice" role="status" aria-live="polite">{notice}</p>
        </aside>
      </section>
    </main>
  );
}
