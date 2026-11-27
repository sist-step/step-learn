PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` integer PRIMARY KEY NOT NULL,
	`email` text COLLATE NOCASE NOT NULL,
	`name` text NOT NULL,
	`username` text COLLATE NOCASE,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'student' NOT NULL,
	`theme` text DEFAULT 'glass' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "users_role" CHECK("__new_users"."role" IN ('admin', 'teacher', 'student')),
	CONSTRAINT "users_theme" CHECK("__new_users"."theme" IN ('glass', 'soft', 'cute'))
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "email", "name", "username", "password_hash", "role", "theme", "created_at") SELECT "id", "email", "name", "username", "password_hash", "role", "theme", "created_at" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_username` ON `users` (`username`);