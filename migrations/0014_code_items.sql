CREATE TABLE `code_drafts` (
	`item_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`files` text NOT NULL,
	`stdin` text DEFAULT '' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`item_id`, `user_id`),
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `code_drafts_user` ON `code_drafts` (`user_id`);--> statement-breakpoint
CREATE TABLE `code_items` (
	`item_id` integer PRIMARY KEY NOT NULL,
	`language` text NOT NULL,
	`starter` text NOT NULL,
	`stdin` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "code_items_language" CHECK("code_items"."language" IN ('web', 'python'))
);
--> statement-breakpoint
CREATE TABLE `code_submissions` (
	`id` integer PRIMARY KEY NOT NULL,
	`item_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`files` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `code_submissions_item_user` ON `code_submissions` (`item_id`,`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `code_submissions_user` ON `code_submissions` (`user_id`);