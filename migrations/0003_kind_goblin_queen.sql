ALTER TABLE `users` ADD `username` text COLLATE NOCASE;--> statement-breakpoint
CREATE UNIQUE INDEX `users_username` ON `users` (`username`);