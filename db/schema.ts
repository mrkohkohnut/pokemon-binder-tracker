import { sql } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const binderCollections = sqliteTable("binder_collections", {
  userId: text("user_id").primaryKey(),
  collectionJson: text("collection_json").notNull().default("{}"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
