CREATE TABLE `mail_queue` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16),
	`recipient` varchar(191) NOT NULL,
	`kind` varchar(32) NOT NULL,
	`locale` varchar(2) NOT NULL DEFAULT 'id',
	`subject` varchar(255) NOT NULL,
	`text` text NOT NULL,
	`html` text NOT NULL,
	`status` varchar(8) NOT NULL DEFAULT 'queued',
	`attempts` int NOT NULL DEFAULT 0,
	`next_attempt_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`last_error` varchar(255),
	`sent_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `mail_queue_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `mail_queue_due_idx` ON `mail_queue` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `mail_queue_business_idx` ON `mail_queue` (`business_id`,`created_at`);