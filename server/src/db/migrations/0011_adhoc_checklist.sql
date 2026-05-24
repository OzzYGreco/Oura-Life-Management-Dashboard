-- Make templateId nullable on checklist_entries (allows ad-hoc entries with no template)
CREATE TABLE `checklist_entries_new` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `template_id` integer REFERENCES `checklist_templates`(`id`),
  `date` text NOT NULL,
  `created_at` text NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO `checklist_entries_new` (`id`, `template_id`, `date`, `created_at`)
  SELECT `id`, `template_id`, `date`, `created_at` FROM `checklist_entries`;
DROP TABLE `checklist_entries`;
ALTER TABLE `checklist_entries_new` RENAME TO `checklist_entries`;

-- Recreate checklist_entry_items: nullable template_item_id + ad-hoc label/time/importance columns
CREATE TABLE `checklist_entry_items_new` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `entry_id` integer NOT NULL REFERENCES `checklist_entries`(`id`) ON DELETE CASCADE,
  `template_item_id` integer REFERENCES `checklist_template_items`(`id`),
  `label` text,
  `time` text,
  `importance` text,
  `completed` integer NOT NULL DEFAULT 0,
  `completed_at` text,
  `archived` integer NOT NULL DEFAULT 0
);
INSERT INTO `checklist_entry_items_new`
  (`id`, `entry_id`, `template_item_id`, `completed`, `completed_at`, `archived`)
  SELECT `id`, `entry_id`, `template_item_id`, `completed`, `completed_at`, `archived`
  FROM `checklist_entry_items`;
DROP TABLE `checklist_entry_items`;
ALTER TABLE `checklist_entry_items_new` RENAME TO `checklist_entry_items`;
