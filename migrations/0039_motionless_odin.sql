ALTER TABLE `code_items` ADD `stage` text;--> statement-breakpoint
ALTER TABLE `code_items` ADD `guides` text DEFAULT '[]' NOT NULL;