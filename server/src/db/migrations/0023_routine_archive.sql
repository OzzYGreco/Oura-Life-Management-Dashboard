-- Deleting a routine that has history archives it instead, so past days keep
-- their scores. Archived routines are hidden everywhere and never run.
ALTER TABLE `checklist_templates` ADD `archived_at` text;
