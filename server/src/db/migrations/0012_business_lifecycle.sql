-- Money received, as its own record, and the columns that let invoices,
-- payments, clients and retainers be ended or undone without deleting history.
--
-- Until now "paid" was a flag on an invoice. That could say a payment settled
-- several invoices, but not that one invoice was paid in two goes, and a bank
-- transfer left no trace beyond the flag. An allocation is one sum of money
-- applied to one invoice, and the invoice's paid fields become a summary of its
-- allocations.
--
-- The backfill is one allocation per paid invoice, built from exactly the
-- fields the metrics read today (amount, fee, refund, paid date or issue date),
-- so not one figure moves.

CREATE TABLE `business_payment_allocations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	/** The Stripe payment this money came from. Null for a bank transfer or cash. */
	`payment_id` integer,
	`method` text DEFAULT 'bank' NOT NULL,
	`amount` real NOT NULL,
	`fee` real DEFAULT 0 NOT NULL,
	`refunded` real DEFAULT 0 NOT NULL,
	`date` text NOT NULL,
	`note` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `business_invoices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`payment_id`) REFERENCES `stripe_payments`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `idx_allocations_invoice` ON `business_payment_allocations` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `idx_allocations_payment` ON `business_payment_allocations` (`payment_id`);--> statement-breakpoint

INSERT INTO `business_payment_allocations` (`invoice_id`, `payment_id`, `method`, `amount`, `fee`, `refunded`, `date`)
SELECT
	i.id,
	(SELECT p.id FROM stripe_payments p
	  WHERE p.matched_invoice_id = i.id
	     OR EXISTS (SELECT 1 FROM json_each(p.covers_invoice_ids) j WHERE j.value = i.id)
	  ORDER BY p.id LIMIT 1),
	CASE WHEN EXISTS (SELECT 1 FROM stripe_payments p
	                   WHERE p.matched_invoice_id = i.id
	                      OR EXISTS (SELECT 1 FROM json_each(p.covers_invoice_ids) j WHERE j.value = i.id))
	     THEN 'stripe' ELSE coalesce(i.payment_method, 'bank') END,
	i.amount,
	coalesce(i.fee_amount, 0),
	coalesce(i.refunded_amount, 0),
	coalesce(i.paid_date, i.issue_date)
FROM business_invoices i
WHERE i.status = 'paid';--> statement-breakpoint

-- Void keeps the number and the history; voided_from is what restore returns to.
ALTER TABLE `business_invoices` ADD `voided_at` text;--> statement-breakpoint
ALTER TABLE `business_invoices` ADD `void_reason` text;--> statement-breakpoint
ALTER TABLE `business_invoices` ADD `voided_from` text;--> statement-breakpoint
-- An invoice that exists only because a payment arrived with nothing to settle.
-- If that payment is moved elsewhere, this invoice has no reason to exist.
ALTER TABLE `business_invoices` ADD `raised_from_payment_id` integer;--> statement-breakpoint
UPDATE `business_invoices` SET `raised_from_payment_id` = (
	SELECT p.id FROM stripe_payments p
	WHERE p.matched_invoice_id = business_invoices.id
	  AND (p.match_reason LIKE 'Invoice % raised from this payment'
	    OR p.match_reason LIKE 'Retainer set up from this subscription%')
	LIMIT 1
);--> statement-breakpoint

-- A payment moved by hand must not be auto-matched straight back by the next sync.
ALTER TABLE `stripe_payments` ADD `released_at` text;--> statement-breakpoint

ALTER TABLE `business_clients` ADD `churn_reason` text;--> statement-breakpoint
ALTER TABLE `business_retainers` ADD `paused_at` text;--> statement-breakpoint

-- One invoice per retainer period, ever. Void included, so a voided month is
-- never quietly re-issued by the generator.
CREATE UNIQUE INDEX `idx_business_invoices_retainer_period`
	ON `business_invoices` (`retainer_id`, `period_start`)
	WHERE `retainer_id` IS NOT NULL AND `period_start` IS NOT NULL;--> statement-breakpoint

-- Two price "changes" that were really corrections: the price had been recorded
-- net of the Stripe fee. As changes they read as September expansion and made
-- February to September MRR 19.28 and 19.50. The retainers already hold 20.00.
DELETE FROM `business_retainer_changes`
WHERE id IN (2, 3) AND reason LIKE 'Recorded price was net of the Stripe fee%';
