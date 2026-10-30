ALTER TABLE `courses` ADD `completion_enabled` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `items` ADD `completion` text DEFAULT 'none' NOT NULL;