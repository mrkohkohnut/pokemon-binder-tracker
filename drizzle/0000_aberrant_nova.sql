CREATE TABLE `binder_collections` (
	`user_id` text PRIMARY KEY NOT NULL,
	`collection_json` text DEFAULT '{}' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
