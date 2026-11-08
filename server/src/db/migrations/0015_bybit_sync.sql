-- Bybit sync: trades log themselves from the exchange.
-- New tables and nullable columns only, so no existing figure moves. The two
-- accounts are pointed at their keys here; the keys themselves live in .env.

-- Which .env key pair an account syncs with (BYBIT_<key>_KEY / _SECRET), and
-- the first day it syncs from. Positions opened before that day are left out.
ALTER TABLE `trading_accounts` ADD `bybit_key` text;--> statement-breakpoint
ALTER TABLE `trading_accounts` ADD `bybit_sync_from` text;--> statement-breakpoint
ALTER TABLE `trading_accounts` ADD `bybit_last_sync_at` text;--> statement-breakpoint
ALTER TABLE `trading_accounts` ADD `bybit_last_error` text;--> statement-breakpoint

-- A trade that came from (or was linked to) a Bybit position. external_id is
-- symbol:direction:first entry fill id, which never changes for a position.
ALTER TABLE `trades` ADD `source` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `trades` ADD `external_id` text;--> statement-breakpoint
ALTER TABLE `trades` ADD `closed_at` text;--> statement-breakpoint
-- The Bybit account a synced trade came from. Usually its own account, but a
-- trade taken on one Bybit account can belong in another journal account (the
-- main account was used for real trades before the Trading sub-account
-- existed); the sync finds it by this, and never moves it back.
ALTER TABLE `trades` ADD `bybit_account_id` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `trades_account_external_uq` ON `trades` (`account_id`, `external_id`);--> statement-breakpoint

-- Every fill and funding payment Bybit reports, kept for good: Bybit only
-- serves two years back, and positions are rebuilt from these rows. Keyed per
-- account: Bybit gives a funding payment the same id on every account that
-- held the coin at that moment.
CREATE TABLE `bybit_executions` (
	`account_id` integer NOT NULL REFERENCES `trading_accounts`(`id`),
	`exec_id` text NOT NULL,
	`symbol` text NOT NULL,
	`side` text NOT NULL,
	`exec_type` text NOT NULL,
	`order_id` text,
	`order_type` text,
	`stop_order_type` text,
	`exec_time` integer NOT NULL,
	`seq` integer,
	`price` real NOT NULL,
	`qty` real NOT NULL,
	`closed_size` real,
	`fee` real NOT NULL,
	`is_maker` integer,
	PRIMARY KEY (`account_id`, `exec_id`)
);--> statement-breakpoint
CREATE INDEX `bybit_executions_account_time` ON `bybit_executions` (`account_id`, `exec_time`);--> statement-breakpoint

-- Orders, for the stop loss: Bybit keeps it on the order, not on the fill.
CREATE TABLE `bybit_orders` (
	`account_id` integer NOT NULL REFERENCES `trading_accounts`(`id`),
	`order_id` text NOT NULL,
	`symbol` text NOT NULL,
	`side` text NOT NULL,
	`order_type` text,
	`stop_order_type` text,
	`status` text,
	`position_idx` integer,
	`trigger_price` real,
	`stop_loss` real,
	`take_profit` real,
	`created_time` integer NOT NULL,
	`updated_time` integer NOT NULL,
	PRIMARY KEY (`account_id`, `order_id`)
);--> statement-breakpoint
CREATE INDEX `bybit_orders_account_symbol` ON `bybit_orders` (`account_id`, `symbol`, `created_time`);--> statement-breakpoint

UPDATE `trading_accounts` SET `bybit_key` = 'TRADING' WHERE `id` = 1;--> statement-breakpoint
UPDATE `trading_accounts` SET `bybit_key` = 'LIVETEST' WHERE `id` = 2;
