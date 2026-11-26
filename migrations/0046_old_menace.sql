ALTER TABLE `sections` ADD `parent_id` integer REFERENCES sections(id);--> statement-breakpoint
CREATE INDEX `sections_parent` ON `sections` (`parent_id`,`position`);