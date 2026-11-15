CREATE TABLE `quiz_attempts` (
	`id` integer PRIMARY KEY NOT NULL,
	`item_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`answers` text NOT NULL,
	`correct` integer NOT NULL,
	`total` integer NOT NULL,
	`passed` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `quiz_attempts_item_user` ON `quiz_attempts` (`item_id`,`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `quiz_attempts_user` ON `quiz_attempts` (`user_id`);--> statement-breakpoint
CREATE TABLE `quiz_items` (
	`item_id` integer PRIMARY KEY NOT NULL,
	`questions` text DEFAULT '[]' NOT NULL,
	`pass_percent` integer DEFAULT 80 NOT NULL,
	`show_answers` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
