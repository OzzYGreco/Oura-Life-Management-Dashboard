ALTER TABLE `checklist_template_items` ADD `time` text;--> statement-breakpoint
ALTER TABLE `checklist_template_items` ADD `importance` text;--> statement-breakpoint
ALTER TABLE `checklist_template_items` ADD `repeat_daily` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `checklist_templates` ADD `enabled` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `checklist_templates` ADD `repeat_daily` integer DEFAULT 1 NOT NULL;