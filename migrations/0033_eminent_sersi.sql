ALTER TABLE `agent_items` ADD `openrouter_api_key` blob;--> statement-breakpoint
ALTER TABLE `agent_items` ADD `openrouter_api_key_hint` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_items` ADD `model` text DEFAULT 'claude-haiku-5-5' NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_items` ADD `openrouter_model` text;