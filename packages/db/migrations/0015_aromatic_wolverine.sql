CREATE TABLE `platform_admins` (
	`id` binary(16) NOT NULL,
	`email` varchar(191) NOT NULL,
	`name` varchar(120) NOT NULL,
	`password_hash` varchar(100) NOT NULL,
	`role` varchar(8) NOT NULL DEFAULT 'support',
	`status` varchar(8) NOT NULL DEFAULT 'active',
	`last_login_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `platform_admins_id` PRIMARY KEY(`id`),
	CONSTRAINT `platform_admins_email_uq` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `platform_audit` (
	`id` binary(16) NOT NULL,
	`admin_id` binary(16),
	`action` varchar(40) NOT NULL,
	`business_id` binary(16),
	`detail` json,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `platform_audit_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `platform_audit` ADD CONSTRAINT `platform_audit_admin_id_platform_admins_id_fk` FOREIGN KEY (`admin_id`) REFERENCES `platform_admins`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `platform_audit_time_idx` ON `platform_audit` (`created_at`);--> statement-breakpoint
CREATE INDEX `platform_audit_business_idx` ON `platform_audit` (`business_id`,`created_at`);