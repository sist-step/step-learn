ALTER TABLE `agent_items` ADD `openrouter_api_key` blob;--> statement-breakpoint
ALTER TABLE `agent_items` ADD `openrouter_api_key_hint` text DEFAULT '' NOT NULL;