-- Planned risk vs risk at the stop.
-- risk_dollars stays the planned risk (what the trade was meant to risk; R:R is
-- measured against it). risk_at_stop is what Bybit's position would have lost
-- at its first stop, fees included, and is always the sync's. risk_source says
-- who set risk_dollars: 'user' is never overwritten; 'bybit' follows the stop.
ALTER TABLE `trades` ADD `risk_at_stop` real;--> statement-breakpoint
ALTER TABLE `trades` ADD `risk_source` text;--> statement-breakpoint
-- One full-size risk (1R) per account, for the half / full / scaled buttons.
ALTER TABLE `trading_accounts` ADD `full_risk` real;--> statement-breakpoint
-- Every risk typed in before today was the user's own plan.
UPDATE `trades` SET `risk_source` = 'user' WHERE `risk_dollars` IS NOT NULL AND `source` = 'manual';
