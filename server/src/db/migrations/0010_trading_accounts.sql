CREATE TABLE `trading_accounts` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `broker` text,
  `currency` text NOT NULL DEFAULT 'USD',
  `starting_balance` real,
  `notes` text,
  `created_at` text NOT NULL DEFAULT (datetime('now')),
  `updated_at` text NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
INSERT INTO `trading_accounts` (`name`, `broker`, `currency`) VALUES ('Default', '', 'USD');
--> statement-breakpoint
ALTER TABLE `trades` ADD COLUMN `account_id` integer REFERENCES `trading_accounts`(`id`);
--> statement-breakpoint
UPDATE `trades` SET `account_id` = (SELECT `id` FROM `trading_accounts` WHERE `name` = 'Default') WHERE `account_id` IS NULL;
