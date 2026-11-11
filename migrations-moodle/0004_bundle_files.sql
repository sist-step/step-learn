CREATE TABLE `bundle_files` (
	`id` integer PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`path` text COLLATE NOCASE NOT NULL,
	`file_key` text NOT NULL,
	`size` integer NOT NULL,
	`sha256` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`key`) REFERENCES `extra_items`(`key`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bundle_files_key_path` ON `bundle_files` (`key`,`path`);