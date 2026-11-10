PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_code_submissions` (
	`id` integer PRIMARY KEY NOT NULL,
	`item_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`files` text NOT NULL,
	`status` text DEFAULT 'none' NOT NULL,
	`score` integer,
	`feedback` text DEFAULT '' NOT NULL,
	`output` text,
	`teacher_score` integer,
	`teacher_comment` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "code_submissions_status" CHECK("__new_code_submissions"."status" IN ('none', 'pending', 'graded', 'failed'))
);
--> statement-breakpoint
INSERT INTO `__new_code_submissions`("id", "item_id", "user_id", "files", "status", "score", "feedback", "output", "teacher_score", "teacher_comment", "created_at") SELECT "id", "item_id", "user_id", "files", "status", "score", "feedback", "output", "teacher_score", "teacher_comment", "created_at" FROM `code_submissions`;--> statement-breakpoint
DROP TABLE `code_submissions`;--> statement-breakpoint
ALTER TABLE `__new_code_submissions` RENAME TO `code_submissions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `code_submissions_item_user` ON `code_submissions` (`item_id`,`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `code_submissions_user` ON `code_submissions` (`user_id`);