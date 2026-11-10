ALTER TABLE `code_items` ADD `criteria` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `code_items` ADD `max_score` integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE `code_submissions` ADD `status` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `code_submissions` ADD `score` integer;--> statement-breakpoint
ALTER TABLE `code_submissions` ADD `feedback` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `code_submissions` ADD `output` text;--> statement-breakpoint
ALTER TABLE `code_submissions` ADD `teacher_score` integer;--> statement-breakpoint
ALTER TABLE `code_submissions` ADD `teacher_comment` text DEFAULT '' NOT NULL;