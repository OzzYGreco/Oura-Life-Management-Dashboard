-- Payment links, failed card charges, a change history, leads, and a few
-- settings the reminders and summaries need. All new tables or nullable
-- columns, so no existing figure moves.

-- Small business-wide settings by key (reminder sign-off, bank details).
CREATE TABLE `business_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);--> statement-breakpoint

-- A Stripe Payment Link made for one invoice.
ALTER TABLE `business_invoices` ADD `payment_link_id` text;--> statement-breakpoint
ALTER TABLE `business_invoices` ADD `payment_link_url` text;--> statement-breakpoint

-- Card payments Stripe tried and failed: a declined renewal is money that did
-- not arrive, and until now nothing showed it.
CREATE TABLE `stripe_failed_charges` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`stripe_id` text NOT NULL,
	`stripe_customer_id` text,
	`subscription_id` text,
	`amount` real NOT NULL,
	`currency` text DEFAULT 'GBP' NOT NULL,
	`failed_date` text NOT NULL,
	`payer_name` text,
	`payer_email` text,
	`failure_message` text,
	`client_id` integer,
	`dismissed_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_failed_charges_stripe` ON `stripe_failed_charges` (`stripe_id`);--> statement-breakpoint

-- What happened to a client and when: price changes, pauses, leaving, coming
-- back, payments moved, bills voided. Written by the routes that do them.
CREATE TABLE `business_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` text DEFAULT (datetime('now')) NOT NULL,
	`client_id` integer,
	`kind` text NOT NULL,
	`summary` text NOT NULL,
	`data` text
);--> statement-breakpoint
CREATE INDEX `idx_events_client` ON `business_events` (`client_id`);--> statement-breakpoint

-- Leads: who might buy, what was quoted, and whether it was won. The base for
-- win rate and cost per client by source. No screen uses it yet.
CREATE TABLE `business_leads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`company` text,
	`email` text,
	`phone` text,
	`source` text,
	`campaign_id` integer,
	`service_id` integer,
	`stage` text DEFAULT 'new' NOT NULL,
	`quote_one_off` real,
	`quote_monthly` real,
	`quoted_at` text,
	`decided_at` text,
	`lost_reason` text,
	`client_id` integer,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
