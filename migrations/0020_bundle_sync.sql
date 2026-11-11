CREATE TABLE `bundle_items` (
	`item_id` integer PRIMARY KEY NOT NULL,
	`sync` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `bundle_sync_versions` (
	`id` integer PRIMARY KEY NOT NULL,
	`item_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`path` text NOT NULL,
	`deleted` integer DEFAULT 0 NOT NULL,
	`sha256` text DEFAULT '' NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`added` integer DEFAULT 0 NOT NULL,
	`removed` integer DEFAULT 0 NOT NULL,
	`content` blob,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bundle_sync_versions_item_user` ON `bundle_sync_versions` (`item_id`,`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `bundle_sync_versions_user` ON `bundle_sync_versions` (`user_id`);