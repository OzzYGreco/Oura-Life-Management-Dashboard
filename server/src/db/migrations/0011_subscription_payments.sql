-- What Stripe knows about a payment that recurs.
--
-- The charge alone only says "Subscription creation", which is a description
-- and can be anything. The invoice behind it carries the facts: whether this is
-- the first payment of a new subscription or a renewal of an existing one, what
-- the plan costs per cycle, how long a cycle is, and what the client is buying.
--
-- Storing it means the app can tell a retainer from a one-off without asking,
-- and can spot a subscription being collected in Stripe with no retainer behind
-- it in Oura, which is how a live GBP 149/mo client sat outside MRR entirely.

ALTER TABLE `stripe_payments` ADD `subscription_id` text;--> statement-breakpoint
ALTER TABLE `stripe_payments` ADD `billing_reason` text;--> statement-breakpoint
ALTER TABLE `stripe_payments` ADD `plan_amount` real;--> statement-breakpoint
ALTER TABLE `stripe_payments` ADD `plan_interval_days` integer;--> statement-breakpoint
ALTER TABLE `stripe_payments` ADD `plan_description` text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_stripe_payments_subscription` ON `stripe_payments` (`subscription_id`);
