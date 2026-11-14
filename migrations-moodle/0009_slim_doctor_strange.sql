CREATE TABLE `agent_items` (
	`key` text PRIMARY KEY NOT NULL,
	`api_key` blob,
	`api_key_hint` text DEFAULT '' NOT NULL,
	`total_limit` real DEFAULT 10 NOT NULL,
	FOREIGN KEY (`key`) REFERENCES `extra_items`(`key`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agent_tokens` (
	`id` integer PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`user_id` integer NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`key`) REFERENCES `extra_items`(`key`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_tokens_hash` ON `agent_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `agent_tokens_key_user` ON `agent_tokens` (`key`,`user_id`);--> statement-breakpoint
CREATE TABLE `agent_usage` (
	`id` integer PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`user_id` integer,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`completion_tokens` integer DEFAULT 0 NOT NULL,
	`cost` real DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`key`) REFERENCES `extra_items`(`key`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `agent_usage_key_user` ON `agent_usage` (`key`,`user_id`);