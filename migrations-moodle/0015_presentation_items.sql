CREATE TABLE `presentation_items` (
	`key` text PRIMARY KEY NOT NULL,
	`file_key` text,
	`file_size` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`slide_ids` text DEFAULT '[]' NOT NULL,
	`animated_pages` text DEFAULT '[]' NOT NULL,
	`trigger_pages` text DEFAULT '[]' NOT NULL,
	`source_name` text DEFAULT '' NOT NULL,
	`released_slide_ids` text DEFAULT '[]' NOT NULL,
	`released_page` integer DEFAULT 0 NOT NULL,
	`current_page` integer,
	`all_released` integer DEFAULT 0 NOT NULL,
	`synced_at` integer,
	`exported_at` integer,
	FOREIGN KEY (`key`) REFERENCES `extra_items`(`key`) ON UPDATE no action ON DELETE cascade
);
