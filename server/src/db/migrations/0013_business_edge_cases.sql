-- Columns for the edge cases the stress test turned up. All nullable, so no
-- existing figure moves.
--
-- resume_on:          a pause with a date it restarts (a seasonal client).
-- leaving_on:         a client who has given notice. They stay active, and
--                     paying, until the day; then they are churned on it.
-- chase_after:        an invoice on hold (being disputed, or agreed to wait),
--                     kept out of "Chase" until this date.
-- disputed:           a card payment the client disputed with their bank.
-- paid_by_owner_id:   a business cost one partner paid personally, so the
--                     business owes it back to them.
-- reimbursed_at:      the day it was paid back.

ALTER TABLE `business_retainers` ADD `resume_on` text;--> statement-breakpoint
ALTER TABLE `business_clients` ADD `leaving_on` text;--> statement-breakpoint
ALTER TABLE `business_invoices` ADD `chase_after` text;--> statement-breakpoint
ALTER TABLE `business_invoices` ADD `hold_reason` text;--> statement-breakpoint
ALTER TABLE `stripe_payments` ADD `disputed` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `finance_expenses` ADD `paid_by_owner_id` integer;--> statement-breakpoint
ALTER TABLE `finance_expenses` ADD `reimbursed_at` text;
