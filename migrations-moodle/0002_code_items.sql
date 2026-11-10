CREATE TABLE `code_drafts` (
	`key` text NOT NULL,
	`user_id` integer NOT NULL,
	`files` text NOT NULL,
	`stdin` text DEFAULT '' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`key`, `user_id`),
	FOREIGN KEY (`key`) REFERENCES `extra_items`(`key`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `code_submissions` (
	`id` integer PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`user_id` integer NOT NULL,
	`files` text NOT NULL,
	`status` text DEFAULT 'none' NOT NULL,
	`score` integer,
	`feedback` text DEFAULT '' NOT NULL,
	`output` text,
	`teacher_score` integer,
	`teacher_comment` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`key`) REFERENCES `extra_items`(`key`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `code_submissions_key_user` ON `code_submissions` (`key`,`user_id`,`id`);