CREATE TABLE `publication_files` (
	`id` integer PRIMARY KEY NOT NULL,
	`item_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`file_key` text NOT NULL,
	`file_name` text NOT NULL,
	`file_size` integer NOT NULL,
	`file_type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "publication_files_status" CHECK("publication_files"."status" IN ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
CREATE INDEX `publication_files_item` ON `publication_files` (`item_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `publication_items` (
	`item_id` integer PRIMARY KEY NOT NULL,
	`approval` integer DEFAULT 1 NOT NULL,
	`show_names` integer DEFAULT 1 NOT NULL,
	`opens_at` integer,
	`closes_at` integer,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_items` (
	`id` integer PRIMARY KEY NOT NULL,
	`course_id` integer NOT NULL,
	`section_id` integer NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`link_target` text DEFAULT 'new' NOT NULL,
	`file_key` text,
	`file_name` text,
	`file_size` integer,
	`file_type` text,
	`hidden` integer DEFAULT 0 NOT NULL,
	`availability` text,
	`completion` text DEFAULT 'none' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`section_id`) REFERENCES `sections`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "items_type" CHECK("__new_items"."type" IN ('page', 'link', 'file', 'screen', 'code', 'bundle', 'agent', 'quiz', 'collab', 'presentation', 'publication')),
	CONSTRAINT "items_completion" CHECK("__new_items"."completion" IN ('none', 'manual', 'view', 'play', 'clear', 'pass')),
	CONSTRAINT "items_link_target" CHECK("__new_items"."link_target" IN ('new', 'same', 'embed'))
);
--> statement-breakpoint
INSERT INTO `__new_items`("id", "course_id", "section_id", "type", "title", "body", "url", "link_target", "file_key", "file_name", "file_size", "file_type", "hidden", "availability", "completion", "position", "created_at", "updated_at") SELECT "id", "course_id", "section_id", "type", "title", "body", "url", "link_target", "file_key", "file_name", "file_size", "file_type", "hidden", "availability", "completion", "position", "created_at", "updated_at" FROM `items`;--> statement-breakpoint
DROP TABLE `items`;--> statement-breakpoint
ALTER TABLE `__new_items` RENAME TO `items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `items_section` ON `items` (`section_id`,`position`);--> statement-breakpoint
CREATE INDEX `items_course` ON `items` (`course_id`);