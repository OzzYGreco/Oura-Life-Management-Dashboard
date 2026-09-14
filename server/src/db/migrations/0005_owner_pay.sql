-- Owner's pay: a distribution of profit, not a cost of making it.
--
-- Zavabuild has two partners on a 50/50 split. Before this migration the only
-- record of them paying themselves was two finance_expenses rows categorised
-- 'Business', which meant the money was subtracted ABOVE net profit (so the
-- business read less profitable than it was) and was also excluded from personal
-- spending by the dashboard's `category != 'Business'` filter. It fell through
-- every view.
--
-- This migration gives draws their own ledger and moves those two rows into it.

CREATE TABLE `business_owners` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`share_pct` real DEFAULT 0 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `business_owner_draws` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` integer NOT NULL,
	`amount` real NOT NULL,
	`currency` text DEFAULT 'GBP' NOT NULL,
	`date` text NOT NULL,
	`method` text,
	`notes` text,
	`finance_income_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `business_owners`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_business_owner_draws_owner` ON `business_owner_draws` (`owner_id`);
--> statement-breakpoint
CREATE INDEX `idx_business_owner_draws_date` ON `business_owner_draws` (`date`);
--> statement-breakpoint

-- The two partners, 50/50.
INSERT INTO `business_owners` (`name`, `share_pct`, `active`, `sort_order`)
SELECT 'Aristomenis', 50, 1, 0
WHERE NOT EXISTS (SELECT 1 FROM `business_owners` WHERE `name` = 'Aristomenis');
--> statement-breakpoint
INSERT INTO `business_owners` (`name`, `share_pct`, `active`, `sort_order`)
SELECT 'Chris', 50, 1, 1
WHERE NOT EXISTS (SELECT 1 FROM `business_owners` WHERE `name` = 'Chris');
--> statement-breakpoint

-- Move every existing payout expense into the draw ledger. The description is
-- matched against the owner name, so "Aristomenis' payout" finds Aristomenis.
-- Anything that says payout but matches no owner is deliberately left alone
-- rather than guessed at.
INSERT INTO `business_owner_draws` (`owner_id`, `amount`, `currency`, `date`, `method`, `notes`)
SELECT o.`id`, e.`amount`, 'GBP', e.`date`, 'transfer', e.`description`
FROM `finance_expenses` e
JOIN `business_owners` o ON e.`description` LIKE '%' || o.`name` || '%'
WHERE e.`category` = 'Business'
  AND e.`description` LIKE '%payout%'
  AND NOT EXISTS (
    SELECT 1 FROM `business_owner_draws` d
    WHERE d.`owner_id` = o.`id` AND d.`date` = e.`date` AND d.`amount` = e.`amount`
  );
--> statement-breakpoint

-- Now drop them from the expense ledger, so profit stops being charged for them.
DELETE FROM `finance_expenses`
WHERE `category` = 'Business'
  AND `description` LIKE '%payout%'
  AND EXISTS (
    SELECT 1 FROM `business_owners` o WHERE `finance_expenses`.`description` LIKE '%' || o.`name` || '%'
  );
