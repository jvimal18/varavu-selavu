CREATE TABLE `user_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`primary_account_id` text,
	`monthly_budget_paise` integer,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`primary_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
