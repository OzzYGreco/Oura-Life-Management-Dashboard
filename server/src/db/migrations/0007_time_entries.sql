CREATE TABLE `business_time_entries` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `project_id` integer NOT NULL REFERENCES `business_projects`(`id`) ON DELETE CASCADE,
  `date` text NOT NULL,
  `hours` real NOT NULL,
  `description` text,
  `billable` integer DEFAULT 1 NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL
);
