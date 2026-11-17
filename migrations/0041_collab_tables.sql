CREATE TABLE `collab_docs` (
	`id` integer PRIMARY KEY NOT NULL,
	`item_id` integer NOT NULL,
	`owner` text NOT NULL,
	`user_id` integer,
	`state` blob NOT NULL,
	`updated_by` integer,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collab_docs_item_owner` ON `collab_docs` (`item_id`,`owner`);--> statement-breakpoint
CREATE INDEX `collab_docs_user` ON `collab_docs` (`user_id`);--> statement-breakpoint
CREATE TABLE `collab_items` (
	`item_id` integer PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`scope` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "collab_items_kind" CHECK("collab_items"."kind" IN ('doc', 'sheet', 'slides', 'board')),
	CONSTRAINT "collab_items_scope" CHECK("collab_items"."scope" IN ('course', 'student'))
);
