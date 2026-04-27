CREATE TABLE `admin_vetoes` (
	`chat_id` integer NOT NULL,
	`message_id` integer NOT NULL,
	`admin_user_id` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_vetoes_message_admin_unique` ON `admin_vetoes` (`chat_id`,`message_id`,`admin_user_id`);--> statement-breakpoint
CREATE INDEX `admin_vetoes_message_idx` ON `admin_vetoes` (`chat_id`,`message_id`);--> statement-breakpoint
CREATE TABLE `deletion_queue` (
	`chat_id` integer NOT NULL,
	`message_id` integer NOT NULL,
	`detected_at` integer NOT NULL,
	`delete_after` integer NOT NULL,
	`matched_word` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`deleted_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deletion_queue_message_unique` ON `deletion_queue` (`chat_id`,`message_id`);--> statement-breakpoint
CREATE INDEX `deletion_queue_due_idx` ON `deletion_queue` (`status`,`delete_after`);