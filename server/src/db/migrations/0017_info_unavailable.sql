-- A trade whose journal side can no longer be filled in (no notes or charts
-- from the time). It keeps whatever it has, invents nothing, and is no longer
-- counted as needing info.
ALTER TABLE `trades` ADD `info_unavailable` integer DEFAULT 0 NOT NULL;
