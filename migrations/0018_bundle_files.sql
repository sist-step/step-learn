CREATE TABLE `bundle_files` (
	`id` integer PRIMARY KEY NOT NULL,
	`item_id` integer NOT NULL,
	`path` text COLLATE NOCASE NOT NULL,
	`file_key` text NOT NULL,
	`size` integer NOT NULL,
	`sha256` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bundle_files_item_path` ON `bundle_files` (`item_id`,`path`);