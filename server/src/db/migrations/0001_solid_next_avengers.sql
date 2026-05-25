ALTER TABLE `trades` ADD `is_compounded` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `trades` ADD `entries` text;--> statement-breakpoint
ALTER TABLE `trades` ADD `take_profits` text;