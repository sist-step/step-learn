ALTER TABLE `code_items` ADD `constraints` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `code_submissions` ADD `verdicts` text;