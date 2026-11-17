CREATE TABLE `collab_docs` (
	`id` integer PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`owner` text NOT NULL,
	`user_id` integer,
	`state` blob NOT NULL,
	`updated_by` integer,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`key`) REFERENCES `extra_items`(`key`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collab_docs_key_owner` ON `collab_docs` (`key`,`owner`);