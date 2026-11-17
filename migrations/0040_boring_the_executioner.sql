PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_code_items` (
	`item_id` integer PRIMARY KEY NOT NULL,
	`language` text NOT NULL,
	`starter` text NOT NULL,
	`stdin` text DEFAULT '' NOT NULL,
	`criteria` text DEFAULT '' NOT NULL,
	`constraints` text DEFAULT '[]' NOT NULL,
	`opens_at` integer,
	`closes_at` integer,
	`solution` text DEFAULT '{}' NOT NULL,
	`solution_public` integer DEFAULT 0 NOT NULL,
	`stage` text,
	`guides` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "code_items_language" CHECK("__new_code_items"."language" IN ('web', 'python')),
	CONSTRAINT "code_items_stage" CHECK("__new_code_items"."stage" IS NULL OR "__new_code_items"."stage" IN ('draft', 'preparing', 'ready', 'failed'))
);
--> statement-breakpoint
INSERT INTO `__new_code_items`("item_id", "language", "starter", "stdin", "criteria", "constraints", "opens_at", "closes_at", "solution", "solution_public", "stage", "guides") SELECT "item_id", "language", "starter", "stdin", "criteria", "constraints", "opens_at", "closes_at", "solution", "solution_public", "stage", "guides" FROM `code_items`;--> statement-breakpoint
DROP TABLE `code_items`;--> statement-breakpoint
ALTER TABLE `__new_code_items` RENAME TO `code_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;