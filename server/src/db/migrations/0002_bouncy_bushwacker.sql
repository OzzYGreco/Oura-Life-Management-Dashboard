PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `trades_new` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `date` text NOT NULL,
  `time` text,
  `duration_minutes` integer,
  `instrument` text NOT NULL,
  `asset` text NOT NULL,
  `direction` text NOT NULL,
  `order_type` text NOT NULL,
  `entry_price` real NOT NULL,
  `stop_loss` real,
  `exit_price` real,
  `size` real,
  `risk_dollars` real,
  `expected_loss` real,
  `realized_pnl` real,
  `deviation_pct` real,
  `rr_ratio` real,
  `exit_order_type` text,
  `entry_fee_amount` real,
  `exit_fee_amount` real,
  `slippage_amount` real,
  `net_pnl` real,
  `rules_met` integer,
  `setup_label` text,
  `quick_note` text,
  `mistakes` text,
  `mistakes_other` text,
  `tags` text,
  `created_at` text NOT NULL DEFAULT (datetime('now')),
  `updated_at` text NOT NULL DEFAULT (datetime('now'))
);--> statement-breakpoint
INSERT INTO `trades_new` SELECT
  `id`, `date`, `time`, `duration_minutes`, `instrument`, `asset`, `direction`, `order_type`,
  `entry_price`, `stop_loss`, `exit_price`, `size`, `risk_dollars`, `expected_loss`,
  `realized_pnl`, `deviation_pct`, `rr_ratio`, `exit_order_type`, `entry_fee_amount`,
  `exit_fee_amount`, `slippage_amount`, `net_pnl`, `rules_met`, `setup_label`, `quick_note`,
  `mistakes`, `mistakes_other`, `tags`, `created_at`, `updated_at`
FROM `trades`;--> statement-breakpoint
DROP TABLE `trades`;--> statement-breakpoint
ALTER TABLE `trades_new` RENAME TO `trades`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
