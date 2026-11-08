-- The daily loop: routine items get a time window and a schedule, ticks are
-- scored (on time, late at half credit, missed at zero), each day is closed
-- with a short review, and weekly goal tasks can be scored from data.

-- Routine items: how long the window stays open, which days the item runs,
-- an optional fixed point value, and retirement instead of deletion so past
-- days keep their history.
ALTER TABLE `checklist_template_items` ADD `window_min` integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE `checklist_template_items` ADD `schedule` text;--> statement-breakpoint
ALTER TABLE `checklist_template_items` ADD `points` real;--> statement-breakpoint
ALTER TABLE `checklist_template_items` ADD `retired_at` text;--> statement-breakpoint

-- A day's items: the scored result, the reason given for a miss, and the
-- points the result earned.
ALTER TABLE `checklist_entry_items` ADD `result` text;--> statement-breakpoint
ALTER TABLE `checklist_entry_items` ADD `reason` text;--> statement-breakpoint
ALTER TABLE `checklist_entry_items` ADD `points_earned` real;--> statement-breakpoint

-- One row per closed day (the day runs 04:00 to 04:00). The score is locked
-- when the day is closed by the evening review or automatically at 04:00.
CREATE TABLE `day_reviews` (
	`date` text PRIMARY KEY NOT NULL,
	`score` real NOT NULL,
	`earned` real NOT NULL,
	`possible` real NOT NULL,
	`reflection` text,
	`auto_closed` integer DEFAULT 0 NOT NULL,
	`closed_at` text DEFAULT (datetime('now')) NOT NULL
);--> statement-breakpoint

-- App-wide settings that must survive a browser change (skin, review time,
-- quiet hours, notifications on/off).
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);--> statement-breakpoint

-- Every notification sent, so nothing fires twice across restarts.
CREATE TABLE `notifications_sent` (
	`key` text PRIMARY KEY NOT NULL,
	`sent_at` text DEFAULT (datetime('now')) NOT NULL
);--> statement-breakpoint

-- Weekly goal tasks scored from data instead of by hand.
-- source: manual | checklist | workouts | trading_rules | journal_reviewed
ALTER TABLE `goal_tasks` ADD `source` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `goal_tasks` ADD `target` real;
