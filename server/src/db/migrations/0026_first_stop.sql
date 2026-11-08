-- Bybit amends a stop in place: the same order id, a new trigger price. The
-- first trigger seen is kept here, so a stop moved later never becomes the
-- trade's risk. Existing rows start from the trigger they have now.
ALTER TABLE `bybit_orders` ADD `first_trigger_price` real;
--> statement-breakpoint
UPDATE `bybit_orders` SET `first_trigger_price` = `trigger_price`;
