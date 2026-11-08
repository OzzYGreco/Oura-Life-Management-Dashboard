-- The goal chain: 3-year directions hold milestones (yearly and 3-year goals
-- are milestones, reached or not, never scored). Monthly and weekly goals keep
-- their points; each of their tasks can now point at the level above:
-- a weekly task at a monthly task, a monthly task (or a habit) at a milestone.

-- A 3-year direction, shown as a lane on the roadmap.
CREATE TABLE `goal_directions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`why` text,
	`target_date` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);--> statement-breakpoint

-- A SMART milestone. `measure` says where its current value comes from:
-- manual (typed), steps (a checklist), or app data (business_mrr,
-- business_clients, routine_avg, trading_net_r, training_workouts,
-- training_lift, weeks_beaten). `measure_param` narrows it, e.g. the lift's
-- name. kind 'foundation' holds habits (e.g. average day score 60+).
CREATE TABLE `milestones` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`direction_id` integer REFERENCES `goal_directions`(`id`) ON DELETE SET NULL,
	`kind` text DEFAULT 'milestone' NOT NULL,
	`title` text NOT NULL,
	`done_means` text,
	`measure` text DEFAULT 'manual' NOT NULL,
	`measure_param` text,
	`unit` text,
	`start_value` real,
	`target_value` real,
	`manual_value` real,
	`higher_is_better` integer DEFAULT 1 NOT NULL,
	`start_date` text NOT NULL,
	`due_date` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`reached_at` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);--> statement-breakpoint

-- Steps for milestones that are not a number ("launch the site").
CREATE TABLE `milestone_steps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`milestone_id` integer NOT NULL REFERENCES `milestones`(`id`) ON DELETE CASCADE,
	`title` text NOT NULL,
	`done_at` text,
	`sort_order` integer DEFAULT 0 NOT NULL
);--> statement-breakpoint

-- Links up the chain. Both stay empty for an unlinked task.
ALTER TABLE `goal_tasks` ADD `parent_task_id` integer REFERENCES `goal_tasks`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `goal_tasks` ADD `milestone_id` integer REFERENCES `milestones`(`id`) ON DELETE SET NULL;--> statement-breakpoint

CREATE INDEX `milestones_direction_idx` ON `milestones` (`direction_id`);--> statement-breakpoint
CREATE INDEX `goal_tasks_parent_idx` ON `goal_tasks` (`parent_task_id`);--> statement-breakpoint
CREATE INDEX `goal_tasks_milestone_idx` ON `goal_tasks` (`milestone_id`);
