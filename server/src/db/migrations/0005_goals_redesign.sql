PRAGMA foreign_keys=OFF;--> statement-breakpoint

DROP TABLE IF EXISTS `goals`;--> statement-breakpoint

CREATE TABLE `goals` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `horizon` text NOT NULL,
  `focus` text NOT NULL,
  `period_start` text,
  `period_end` text,
  `status` text NOT NULL DEFAULT 'active',
  `created_at` text NOT NULL DEFAULT (datetime('now')),
  `updated_at` text NOT NULL DEFAULT (datetime('now'))
);--> statement-breakpoint

CREATE TABLE `goal_tasks` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `goal_id` integer NOT NULL REFERENCES `goals`(`id`) ON DELETE CASCADE,
  `title` text NOT NULL,
  `max_points` real NOT NULL DEFAULT 1,
  `earned_points` real,
  `notes` text,
  `sort_order` integer NOT NULL DEFAULT 0
);--> statement-breakpoint

CREATE TABLE `goal_rewards` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `goal_id` integer NOT NULL REFERENCES `goals`(`id`) ON DELETE CASCADE,
  `min_score` real NOT NULL,
  `reward` text NOT NULL,
  `sort_order` integer NOT NULL DEFAULT 0
);--> statement-breakpoint

PRAGMA foreign_keys=ON;
