CREATE TABLE `quiz_attempts` (
	`id` integer PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`user_id` integer NOT NULL,
	`answers` text NOT NULL,
	`correct` integer NOT NULL,
	`total` integer NOT NULL,
	`passed` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`key`) REFERENCES `extra_items`(`key`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `quiz_attempts_key_user` ON `quiz_attempts` (`key`,`user_id`,`id`);