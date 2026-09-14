-- One payment can settle several invoices.
--
-- A new client often pays the website and the first month of SEO in one go:
-- Michael Doherty's GBP448.98 was GBP299.98 for the build plus GBP149.00 for the
-- first month. Tying a payment to a single invoice could only ever record half
-- of that, and the fee would land entirely on whichever half was chosen.
--
-- The ids are stored as a JSON array, and the fee is split across them in
-- proportion to their amounts so the parts always sum to what Stripe charged.

ALTER TABLE `stripe_payments` ADD `covers_invoice_ids` text;
