-- Planning a day ahead. A routine item skipped for one day is archived with
-- `skipped` set, so resuming a routine or reopening a day never brings it
-- back. A one-day item keeps its own window length (the "30m" typed with it),
-- since it has no routine item to take one from.
ALTER TABLE `checklist_entry_items` ADD `skipped` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `checklist_entry_items` ADD `window_min` integer;
