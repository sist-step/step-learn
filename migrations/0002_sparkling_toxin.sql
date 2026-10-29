PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_items` (
	`id` integer PRIMARY KEY NOT NULL,
	`course_id` integer NOT NULL,
	`section_id` integer NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`file_key` text,
	`file_name` text,
	`file_size` integer,
	`file_type` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`section_id`) REFERENCES `sections`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "items_type" CHECK("__new_items"."type" IN ('page', 'link', 'file', 'screen'))
);
--> statement-breakpoint
INSERT INTO `__new_items`("id", "course_id", "section_id", "type", "title", "body", "url", "file_key", "file_name", "file_size", "file_type", "position", "created_at", "updated_at") SELECT "id", "course_id", "section_id", "type", "title", "body", "url", "file_key", "file_name", "file_size", "file_type", "position", "created_at", "updated_at" FROM `items`;--> statement-breakpoint
DROP TABLE `items`;--> statement-breakpoint
ALTER TABLE `__new_items` RENAME TO `items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `items_section` ON `items` (`section_id`,`position`);--> statement-breakpoint
CREATE INDEX `items_course` ON `items` (`course_id`);