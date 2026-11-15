CREATE TABLE `ai_uploads` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`file_key` text NOT NULL,
	`file_name` text NOT NULL,
	`file_size` integer NOT NULL,
	`file_type` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_uploads_user` ON `ai_uploads` (`user_id`);--> statement-breakpoint
CREATE INDEX `ai_uploads_created` ON `ai_uploads` (`created_at`);