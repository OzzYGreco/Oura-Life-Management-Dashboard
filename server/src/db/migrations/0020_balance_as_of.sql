-- When starting_balance was true (UTC ISO). The account's balance is that
-- amount plus the net result of every trade closed after it; the equity curve
-- starts there. Null = no known balance: the trading page shows R only.
ALTER TABLE `trading_accounts` ADD `starting_balance_at` text;
