CREATE TABLE `course_group_members` (
	`group_id` integer NOT NULL,
	`course_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	PRIMARY KEY(`group_id`, `user_id`),
	FOREIGN KEY (`group_id`) REFERENCES `course_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`course_id`,`user_id`) REFERENCES `enrollments`(`course_id`,`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `course_group_members_course_user` ON `course_group_members` (`course_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `course_groups` (
	`id` integer PRIMARY KEY NOT NULL,
	`course_id` integer NOT NULL,
	`name` text COLLATE NOCASE NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `course_groups_course_name` ON `course_groups` (`course_id`,`name`);