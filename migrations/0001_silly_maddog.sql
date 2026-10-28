CREATE TABLE `email_verifications` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`email` text COLLATE NOCASE NOT NULL,
	`next` text DEFAULT '' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `email_verifications_email` ON `email_verifications` (`email`);