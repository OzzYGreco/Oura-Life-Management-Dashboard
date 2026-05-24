ALTER TABLE `finance_expenses` ADD COLUMN `recurring_parent_id` integer;
--> statement-breakpoint
ALTER TABLE `finance_expenses` ADD COLUMN `last_generated_date` text;
--> statement-breakpoint
ALTER TABLE `finance_income` ADD COLUMN `recurring_parent_id` integer;
--> statement-breakpoint
ALTER TABLE `finance_income` ADD COLUMN `last_generated_date` text;
