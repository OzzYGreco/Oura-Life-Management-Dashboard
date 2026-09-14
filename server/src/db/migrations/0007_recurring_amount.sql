-- What a recurring cost will charge NEXT, kept apart from what it charged.
--
-- A recurring expense template doubles as its own first charge: the June row is
-- both "the Localo subscription" and "the £58.80 paid in June". So raising the
-- price by editing the template's amount silently rewrote June's real charge to
-- the new figure, and June never cost that.
--
-- `recurring_amount` is the going-forward price. `amount` stays what was
-- actually paid on the template's own date. Null means the price never changed,
-- so the two are the same and nothing needs to read this column.

ALTER TABLE `finance_expenses` ADD `recurring_amount` real;
