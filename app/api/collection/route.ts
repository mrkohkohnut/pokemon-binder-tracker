import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { binderCollections } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";
import { MAX_COLLECTION_BYTES, normaliseCollection } from "../../../db/collection";

export const dynamic = "force-dynamic";

function cloudError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("no such table") || message.includes("binder_collections")) {
    return "Cloud collection storage is still being prepared. Please try again shortly.";
  }
  return "The cloud collection could not be reached. Your device copy is still safe.";
}

function unauthenticated() {
  return Response.json(
    { authenticated: false, error: "Sign in with ChatGPT to sync your binder." },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return unauthenticated();

  try {
    const db = getDb();
    const [saved] = await db
      .select({ collectionJson: binderCollections.collectionJson, updatedAt: binderCollections.updatedAt })
      .from(binderCollections)
      .where(eq(binderCollections.userId, user.userId))
      .limit(1);

    let collection = {};
    if (saved?.collectionJson) {
      const parsed = normaliseCollection(JSON.parse(saved.collectionJson));
      if (parsed) collection = parsed;
    }

    return Response.json(
      {
        authenticated: true,
        user: { id: user.userId, displayName: user.displayName },
        collection,
        updatedAt: saved?.updatedAt ?? null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        authenticated: true,
        user: { id: user.userId, displayName: user.displayName },
        error: cloudError(error),
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function PUT(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return unauthenticated();

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_COLLECTION_BYTES) {
    return Response.json({ error: "The collection is too large to sync." }, { status: 413 });
  }

  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_COLLECTION_BYTES) {
      return Response.json({ error: "The collection is too large to sync." }, { status: 413 });
    }

    const payload = JSON.parse(rawBody) as { collection?: unknown };
    const collection = normaliseCollection(payload.collection);
    if (!collection) {
      return Response.json({ error: "The collection data is invalid." }, { status: 400 });
    }

    const updatedAt = new Date().toISOString();
    const db = getDb();
    await db
      .insert(binderCollections)
      .values({
        userId: user.userId,
        collectionJson: JSON.stringify(collection),
        updatedAt,
      })
      .onConflictDoUpdate({
        target: binderCollections.userId,
        set: { collectionJson: JSON.stringify(collection), updatedAt },
      });

    return Response.json(
      { ok: true, updatedAt },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      return Response.json({ error: "The collection data is invalid." }, { status: 400 });
    }
    return Response.json(
      { error: cloudError(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
