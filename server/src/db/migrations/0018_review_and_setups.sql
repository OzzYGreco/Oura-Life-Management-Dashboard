-- Setups become their own list, so one can be renamed, merged or retired
-- without touching the trades that used it. trades.setup_label stays the
-- link (by name); a rename or merge rewrites it.
CREATE TABLE `trading_setups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`archived` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trading_setups_name_unique` ON `trading_setups` (`name`);
--> statement-breakpoint
INSERT INTO `trading_setups` (`name`)
	SELECT DISTINCT trim(`setup_label`) FROM `trades`
	WHERE `setup_label` IS NOT NULL AND trim(`setup_label`) != '';
--> statement-breakpoint
-- When the trader finished reviewing a trade (setup, rules, mistakes, risk).
-- Null = waiting in the review queue. Everything already in the journal
-- counts as reviewed: the queue starts with the next trade.
ALTER TABLE `trades` ADD `reviewed_at` text;
--> statement-breakpoint
UPDATE `trades` SET `reviewed_at` = datetime('now');
--> statement-breakpoint
-- When the first stop was placed (UTC ISO; Bybit). Lets the journal tell a
-- stop set with the entry from one added after the trade was already open.
ALTER TABLE `trades` ADD `stop_placed_at` text;
