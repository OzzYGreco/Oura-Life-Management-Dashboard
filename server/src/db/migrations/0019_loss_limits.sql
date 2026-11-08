-- How much an account may lose in a day, a week (Mon-Sun, UTC) and a calendar
-- month before the trader stops. Positive numbers, in loss_limit_unit:
-- 'R' (multiples of full_risk) or 'USD'. Null = no limit for that period.
ALTER TABLE `trading_accounts` ADD `max_loss_day` real;
--> statement-breakpoint
ALTER TABLE `trading_accounts` ADD `max_loss_week` real;
--> statement-breakpoint
ALTER TABLE `trading_accounts` ADD `max_loss_month` real;
--> statement-breakpoint
ALTER TABLE `trading_accounts` ADD `loss_limit_unit` text DEFAULT 'R' NOT NULL;
