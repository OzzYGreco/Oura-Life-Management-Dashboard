-- How far each trade went in its favour (MFE) and against it (MAE) while it
-- was open, from Bybit's public price candles. In R, measured from the entry
-- against the stop distance (or the planned risk when there was no stop).
-- One row per trade; recomputed if the trade changes. Crypto only.
CREATE TABLE `trade_excursions` (
	`trade_id` integer PRIMARY KEY NOT NULL REFERENCES `trades`(`id`) ON DELETE cascade,
	`mfe_price` real,
	`mae_price` real,
	`mfe_r` real,
	`mae_r` real,
	`r_unit` real,
	`interval_min` integer,
	`status` text NOT NULL,
	`basis` text NOT NULL,
	`computed_at` text DEFAULT (datetime('now')) NOT NULL
);
