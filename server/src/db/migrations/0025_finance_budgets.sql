-- The budgets table is in 0000_initial, but the live database was created
-- before it was added there, so it never existed and the Budgets view failed
-- with "no such table". Created here only if it is missing.
CREATE TABLE IF NOT EXISTS `finance_budgets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category` text NOT NULL,
	`monthly_limit` real NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `finance_budgets_category_unique` ON `finance_budgets` (`category`);
