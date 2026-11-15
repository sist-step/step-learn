PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_quiz_items` (
	`item_id` integer PRIMARY KEY NOT NULL,
	`questions` text DEFAULT '[]' NOT NULL,
	`pass_percent` integer DEFAULT 80 NOT NULL,
	`show_answers` integer DEFAULT 1 NOT NULL,
	`look` text DEFAULT 'plain' NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "quiz_items_look" CHECK("__new_quiz_items"."look" IN ('plain', 'game'))
);
--> statement-breakpoint
INSERT INTO `__new_quiz_items`("item_id", "questions", "pass_percent", "show_answers", "look") SELECT "item_id", "questions", "pass_percent", "show_answers", "look" FROM `quiz_items`;--> statement-breakpoint
DROP TABLE `quiz_items`;--> statement-breakpoint
ALTER TABLE `__new_quiz_items` RENAME TO `quiz_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;