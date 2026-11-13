CREATE TABLE `operation_logs` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer,
	`kind` text NOT NULL,
	`action` text NOT NULL,
	`path` text NOT NULL,
	`course_id` integer,
	`target` text,
	`ip` text DEFAULT '' NOT NULL,
	`user_agent` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "operation_logs_kind" CHECK("operation_logs"."kind" IN ('view', 'change', 'important'))
);
--> statement-breakpoint
CREATE INDEX `operation_logs_created` ON `operation_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `operation_logs_user` ON `operation_logs` (`user_id`);--> statement-breakpoint
CREATE INDEX `operation_logs_kind` ON `operation_logs` (`kind`);