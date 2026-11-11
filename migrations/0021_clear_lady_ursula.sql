CREATE TABLE `ai_chats` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`model` text NOT NULL,
	`content` blob NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_chats_user` ON `ai_chats` (`user_id`);--> statement-breakpoint
CREATE INDEX `ai_chats_updated` ON `ai_chats` (`updated_at`);