-- How an invoice was actually paid.
--
-- Without this, an invoice showing a zero fee is ambiguous: it might have been
-- a bank transfer, which genuinely costs nothing, or a card payment whose fee
-- was never recorded. Those look identical, and that is how six of the oldest
-- Stripe fees sat unnoticed at zero.
--
-- 'stripe' is set when a payment is matched. 'bank' is set by hand for the
-- clients who pay by transfer. Null means nobody has said.

ALTER TABLE `business_invoices` ADD `payment_method` text;
