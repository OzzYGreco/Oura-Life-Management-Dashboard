ALTER TABLE `business_invoices` ADD COLUMN `is_recurring` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `business_invoices` ADD COLUMN `frequency` text;
--> statement-breakpoint
ALTER TABLE `business_invoices` ADD COLUMN `recurring_parent_id` integer;
--> statement-breakpoint
ALTER TABLE `business_invoices` ADD COLUMN `last_generated_date` text;
