CREATE TABLE `extra_items` (
	`key` text PRIMARY KEY NOT NULL,
	`course_id` integer NOT NULL,
	`cmid` integer NOT NULL,
	`type` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `extra_items_course` ON `extra_items` (`course_id`);