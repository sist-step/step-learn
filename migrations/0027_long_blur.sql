CREATE TABLE `user_identities` (
	`provider` text NOT NULL,
	`subject` text NOT NULL,
	`user_id` integer NOT NULL,
	`email` text COLLATE NOCASE NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`provider`, `subject`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_identities_provider" CHECK("user_identities"."provider" IN ('microsoft'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_identities_user` ON `user_identities` (`user_id`,`provider`);