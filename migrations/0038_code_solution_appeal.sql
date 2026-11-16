ALTER TABLE `code_items` ADD `solution` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `code_items` ADD `solution_public` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `code_submissions` ADD `appealed_at` integer;--> statement-breakpoint
ALTER TABLE `code_submissions` ADD `appeal_closed_at` integer;