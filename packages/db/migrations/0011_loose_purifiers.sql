CREATE TABLE `business_settings` (
	`business_id` binary(16) NOT NULL,
	`checkout` json,
	`receipt` json,
	`notifications` json,
	`account` json,
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_by` binary(16),
	CONSTRAINT `business_settings_business_id` PRIMARY KEY(`business_id`)
);
--> statement-breakpoint
CREATE TABLE `email_outbox` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`recipient` varchar(191) NOT NULL,
	`kind` varchar(24) NOT NULL,
	`subject` varchar(255) NOT NULL,
	`body` text NOT NULL,
	`status` varchar(12) NOT NULL DEFAULT 'logged',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `email_outbox_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `payment_methods` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`key` varchar(24) NOT NULL,
	`name` varchar(80),
	`is_system` boolean NOT NULL DEFAULT false,
	`enabled` boolean NOT NULL DEFAULT true,
	`position` int unsigned NOT NULL DEFAULT 0,
	`outlet_ids` json,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `payment_methods_id` PRIMARY KEY(`id`),
	CONSTRAINT `payment_methods_key_uq` UNIQUE(`business_id`,`key`)
);
--> statement-breakpoint
ALTER TABLE `business_settings` ADD CONSTRAINT `business_settings_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `business_settings` ADD CONSTRAINT `business_settings_updated_by_users_id_fk` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `email_outbox` ADD CONSTRAINT `email_outbox_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_methods` ADD CONSTRAINT `payment_methods_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `email_outbox_business_idx` ON `email_outbox` (`business_id`,`created_at`);