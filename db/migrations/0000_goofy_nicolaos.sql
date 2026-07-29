CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`institution` text,
	`last4` text,
	`opening_balance` integer NOT NULL,
	`credit_limit` integer,
	`statement_day` integer,
	`due_day` integer,
	`currency` text DEFAULT 'INR' NOT NULL,
	`color` text,
	`icon` text,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`icon` text,
	`color` text,
	`parent_id` text,
	`type` text NOT NULL,
	`is_essential` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`amount` integer NOT NULL,
	`date` text NOT NULL,
	`account_id` text NOT NULL,
	`to_account_id` text,
	`category_id` text,
	`description` text,
	`notes` text,
	`spent_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_txn_date` ON `transactions` (`date`);--> statement-breakpoint
CREATE INDEX `idx_txn_account` ON `transactions` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_txn_category` ON `transactions` (`category_id`);--> statement-breakpoint
CREATE INDEX `idx_txn_spent_by` ON `transactions` (`spent_by`);--> statement-breakpoint
CREATE INDEX `idx_txn_type` ON `transactions` (`type`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`pin_hash` text,
	`created_at` text NOT NULL
);
