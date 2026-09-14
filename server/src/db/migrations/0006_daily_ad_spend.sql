-- Ad spend, day by day.
--
-- A campaign has always carried one lifetime `spent` figure and nothing else,
-- so attributing it to a month meant spreading it evenly across the days the
-- campaign had been running. That is a guess, and it is wrong in exactly the
-- way that matters: a campaign that burned its budget in one week reads as if
-- it trickled out over three months.
--
-- Real daily rows make the guess unnecessary. They come either from the ad
-- platform's API or typed in by hand, and the pro-rating stays as the fallback
-- for periods no row covers, so existing history keeps working untouched.

CREATE TABLE `marketing_spend_daily` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`campaign_id` integer NOT NULL,
	`date` text NOT NULL,
	`spend` real NOT NULL,
	`impressions` integer,
	`clicks` integer,
	`leads` integer,
	/** 'manual' when typed in, otherwise the platform it was pulled from. */
	`source` text DEFAULT 'manual' NOT NULL,
	`synced_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `marketing_campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- One row per campaign per day. A re-sync updates in place rather than stacking
-- a second row for the same day, which is what would silently double ad spend.
CREATE UNIQUE INDEX `idx_marketing_spend_daily_unique` ON `marketing_spend_daily` (`campaign_id`, `date`);
--> statement-breakpoint
CREATE INDEX `idx_marketing_spend_daily_date` ON `marketing_spend_daily` (`date`);
--> statement-breakpoint

-- Where to pull a campaign's spend from, and what it is called over there.
ALTER TABLE `marketing_campaigns` ADD `external_source` text;
--> statement-breakpoint
ALTER TABLE `marketing_campaigns` ADD `external_id` text;
--> statement-breakpoint
ALTER TABLE `marketing_campaigns` ADD `last_synced_at` text;
