ALTER TABLE `trades` ADD `exit_order_type` text;--> statement-breakpoint
ALTER TABLE `trades` ADD `entry_fee_amount` real;--> statement-breakpoint
ALTER TABLE `trades` ADD `exit_fee_amount` real;--> statement-breakpoint
ALTER TABLE `trades` ADD `slippage_amount` real;--> statement-breakpoint
ALTER TABLE `trades` ADD `net_pnl` real;