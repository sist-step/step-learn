CREATE TABLE `user_batch_members` (
	`batch_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`batch_id`, `user_id`),
	FOREIGN KEY (`batch_id`) REFERENCES `user_batches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_batch_members_user` ON `user_batch_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `user_batches` (
	`id` integer PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`created_by` integer,
	`role` text NOT NULL,
	`prefix` text DEFAULT '' NOT NULL,
	`course_id` integer,
	`count` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "user_batches_kind" CHECK("user_batches"."kind" IN ('create', 'reissue')),
	CONSTRAINT "user_batches_role" CHECK("user_batches"."role" IN ('teacher', 'student'))
);
--> statement-breakpoint
CREATE INDEX `user_batches_created` ON `user_batches` (`created_at`);