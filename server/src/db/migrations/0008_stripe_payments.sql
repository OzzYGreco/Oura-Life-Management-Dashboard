-- Payments as Stripe reports them, with the fee Stripe actually charged.
--
-- Fees cannot be worked out by hand. Three identical GBP149.99 invoices in this
-- database were paid with fees of 2.46, 3.05 and 4.07 depending on the card
-- used, a 1.61 spread on the same price. Guessing loses money quietly.
--
-- Every payment is stored whether or not it can be matched to an invoice, so
-- money that arrived is never invisible just because the payer typed something
-- generic in the name field.

CREATE TABLE `stripe_payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	/** Stripe's charge id. Unique, so re-syncing corrects rather than duplicates. */
	`stripe_id` text NOT NULL,
	`payment_intent_id` text,
	`stripe_customer_id` text,
	`stripe_invoice_id` text,
	`amount_gross` real NOT NULL,
	`fee` real DEFAULT 0 NOT NULL,
	`amount_net` real NOT NULL,
	`refunded` real DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'GBP' NOT NULL,
	`paid_date` text NOT NULL,
	`payer_name` text,
	`payer_email` text,
	`description` text,
	`status` text DEFAULT 'succeeded' NOT NULL,
	/** What the app worked out, and how sure it was. */
	`matched_invoice_id` integer,
	`matched_client_id` integer,
	`confidence` text DEFAULT 'none' NOT NULL,
	`match_reason` text,
	`matched_at` text,
	/** Set when a payment is deliberately not business income. */
	`ignored` integer DEFAULT 0 NOT NULL,
	`synced_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`matched_invoice_id`) REFERENCES `business_invoices`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`matched_client_id`) REFERENCES `business_clients`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_stripe_payments_stripe_id` ON `stripe_payments` (`stripe_id`);
--> statement-breakpoint
CREATE INDEX `idx_stripe_payments_date` ON `stripe_payments` (`paid_date`);
--> statement-breakpoint
CREATE INDEX `idx_stripe_payments_customer` ON `stripe_payments` (`stripe_customer_id`);
--> statement-breakpoint

-- Learned once, certain forever after. This is what makes a generic payer name
-- stop mattering: the second payment from a customer is never ambiguous.
ALTER TABLE `business_clients` ADD `stripe_customer_id` text;
