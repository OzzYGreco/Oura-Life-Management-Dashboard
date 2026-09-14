CREATE TABLE `business_services` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'one_off' NOT NULL,
	`default_amount` real,
	`default_frequency` text,
	`milestones` text,
	`default_term_days` integer DEFAULT 7 NOT NULL,
	`color` text,
	`active` integer DEFAULT 1 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `business_retainers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`service_id` integer,
	`name` text NOT NULL,
	`amount` real NOT NULL,
	`currency` text DEFAULT 'GBP' NOT NULL,
	`frequency` text DEFAULT 'monthly' NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`status` text DEFAULT 'active' NOT NULL,
	`cancel_reason` text,
	`cancelled_at` text,
	`net_term_days` integer DEFAULT 0 NOT NULL,
	`auto_invoice` integer DEFAULT 1 NOT NULL,
	`last_generated_date` text,
	`next_invoice_date` text,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `business_clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`service_id`) REFERENCES `business_services`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `business_retainer_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`retainer_id` integer NOT NULL,
	`effective_date` text NOT NULL,
	`old_amount` real NOT NULL,
	`new_amount` real NOT NULL,
	`reason` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`retainer_id`) REFERENCES `business_retainers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `business_invoice_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`description` text NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit_price` real NOT NULL,
	`amount` real NOT NULL,
	`tax_rate` real DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `business_invoices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `business_invoices` ADD `retainer_id` integer REFERENCES business_retainers(id);--> statement-breakpoint
ALTER TABLE `business_invoices` ADD `service_id` integer REFERENCES business_services(id);--> statement-breakpoint
ALTER TABLE `business_invoices` ADD `subtotal` real;--> statement-breakpoint
ALTER TABLE `business_invoices` ADD `tax_rate` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `business_invoices` ADD `tax_amount` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `business_invoices` ADD `fee_amount` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `business_invoices` ADD `refunded_amount` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `business_invoices` ADD `currency` text DEFAULT 'GBP' NOT NULL;--> statement-breakpoint
ALTER TABLE `business_invoices` ADD `milestone_label` text;--> statement-breakpoint
ALTER TABLE `business_invoices` ADD `period_start` text;--> statement-breakpoint
ALTER TABLE `business_invoices` ADD `period_end` text;--> statement-breakpoint
ALTER TABLE `business_invoices` ADD `sent_date` text;--> statement-breakpoint
ALTER TABLE `business_clients` ADD `source` text;--> statement-breakpoint
ALTER TABLE `business_clients` ADD `campaign_id` integer;--> statement-breakpoint
ALTER TABLE `business_clients` ADD `won_date` text;--> statement-breakpoint
ALTER TABLE `business_clients` ADD `churned_at` text;--> statement-breakpoint
ALTER TABLE `business_clients` ADD `vat_number` text;--> statement-breakpoint
ALTER TABLE `business_clients` ADD `address_line` text;--> statement-breakpoint
ALTER TABLE `business_clients` ADD `city` text;--> statement-breakpoint
ALTER TABLE `business_clients` ADD `postcode` text;--> statement-breakpoint
ALTER TABLE `business_clients` ADD `country` text;--> statement-breakpoint
ALTER TABLE `business_projects` ADD `service_id` integer REFERENCES business_services(id);--> statement-breakpoint
ALTER TABLE `business_projects` ADD `stage` text DEFAULT 'discovery' NOT NULL;--> statement-breakpoint
ALTER TABLE `business_projects` ADD `launched_date` text;--> statement-breakpoint
ALTER TABLE `business_projects` ADD `estimated_hours` real;--> statement-breakpoint
ALTER TABLE `finance_expenses` ADD `client_id` integer;--> statement-breakpoint
ALTER TABLE `finance_expenses` ADD `project_id` integer;--> statement-breakpoint
ALTER TABLE `finance_expenses` ADD `vendor` text;--> statement-breakpoint
CREATE INDEX `idx_business_invoices_retainer` ON `business_invoices` (`retainer_id`);--> statement-breakpoint
CREATE INDEX `idx_business_invoices_client` ON `business_invoices` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_business_invoices_issue` ON `business_invoices` (`issue_date`);--> statement-breakpoint
CREATE INDEX `idx_business_retainers_client` ON `business_retainers` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_finance_expenses_client` ON `finance_expenses` (`client_id`);
