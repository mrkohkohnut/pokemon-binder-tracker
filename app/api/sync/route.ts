import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { binderCollections } from "../../../db/schema";
import { MAX_COLLECTION_BYTES, normaliseCollection } from "../../../db/collection";

/**
 * Binder sync for the iOS app, keyed by a secret sync code instead of a ChatGPT account.
 * Send the code as `Authorization: Bearer <code>`. Only its SHA-256 hash is stored, as the
 * row's user_id with a `sync:` prefix, so it never collides with ChatGPT user IDs.
 * The site must be public: Private Sites require a ChatGPT sign-in that the app can't do.
 */
export const dynamic = "force-dynamic";

const SYNC_CODE = /^[A-Z2-9]{20,64}$/;
const NO_STORE = { "Cache-Control": "no-store" };

async function syncKey(request: Request) {
  const code = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!code || !SYNC_CODE.test(code)) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sync:${hex}`;
}

function invalidCode() {
  return Response.json({ error: "Missing or invalid sync code." }, { status: 401, headers: NO_STORE });
}

function serverError() {
  return Response.json({ error: "The cloud collection could not be reached." }, { status: 500, headers: NO_STORE });
}

export async function GET(request: Request) {
  const key = await syncKey(request);
  if (!key) return invalidCode();

  try {
    const [saved] = await getDb()
      .select({ collectionJson: binderCollections.collectionJson, updatedAt: binderCollections.updatedAt })
      .from(binderCollections)
      .where(eq(binderCollections.userId, key))
      .limit(1);
    const collection = saved ? normaliseCollection(JSON.parse(saved.collectionJson)) ?? {} : {};
    return Response.json({ collection, updatedAt: saved?.updatedAt ?? null }, { headers: NO_STORE });
  } catch {
    return serverError();
  }
}

export async function PUT(request: Request) {
  const key = await syncKey(request);
  if (!key) return invalidCode();

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_COLLECTION_BYTES) {
    return Response.json({ error: "The collection is too large to sync." }, { status: 413, headers: NO_STORE });
  }

  let collection: ReturnType<typeof normaliseCollection>;
  try {
    collection = normaliseCollection((JSON.parse(rawBody) as { collection?: unknown }).collection);
  } catch {
    collection = null;
  }
  if (!collection) {
    return Response.json({ error: "The collection data is invalid." }, { status: 400, headers: NO_STORE });
  }

  try {
    const updatedAt = new Date().toISOString();
    const collectionJson = JSON.stringify(collection);
    await getDb()
      .insert(binderCollections)
      .values({ userId: key, collectionJson, updatedAt })
      .onConflictDoUpdate({ target: binderCollections.userId, set: { collectionJson, updatedAt } });
    return Response.json({ ok: true, updatedAt }, { headers: NO_STORE });
  } catch {
    return serverError();
  }
}
