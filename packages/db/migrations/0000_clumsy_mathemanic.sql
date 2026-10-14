CREATE TABLE `businesses` (
	`id` binary(16) NOT NULL,
	`name` varchar(191) NOT NULL,
	`phone` varchar(32),
	`email` varchar(191),
	`address` varchar(500),
	`province` varchar(100),
	`plan` varchar(32) NOT NULL DEFAULT 'basic',
	`currency` varchar(3) NOT NULL DEFAULT 'IDR',
	`currency_exponent` tinyint unsigned NOT NULL DEFAULT 0,
	`default_locale` varchar(5) NOT NULL DEFAULT 'id',
	`week_start` tinyint unsigned NOT NULL DEFAULT 1,
	`settings` json,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `businesses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `outlets` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`name` varchar(191) NOT NULL,
	`address` varchar(500),
	`phone` varchar(32),
	`timezone` varchar(64) NOT NULL DEFAULT 'Asia/Jakarta',
	`status` varchar(16) NOT NULL DEFAULT 'active',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	`active_name` varchar(191) GENERATED ALWAYS AS ((IF(`deleted_at` IS NULL, `name`, NULL))) STORED,
	CONSTRAINT `outlets_id` PRIMARY KEY(`id`),
	CONSTRAINT `outlets_business_name_uq` UNIQUE(`business_id`,`active_name`)
);
--> statement-breakpoint
CREATE TABLE `refresh_tokens` (
	`id` binary(16) NOT NULL,
	`user_id` binary(16) NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`revoked_at` datetime(3),
	`user_agent` varchar(255),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `refresh_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `refresh_tokens_hash_uq` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `role_privileges` (
	`role_id` binary(16) NOT NULL,
	`privilege` varchar(64) NOT NULL,
	CONSTRAINT `role_privileges_role_id_privilege_pk` PRIMARY KEY(`role_id`,`privilege`)
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`name` varchar(120),
	`system_key` varchar(32),
	`access_type` varchar(24) NOT NULL,
	`is_system` boolean NOT NULL DEFAULT false,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `roles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_outlets` (
	`user_id` binary(16) NOT NULL,
	`outlet_id` binary(16) NOT NULL,
	CONSTRAINT `user_outlets_user_id_outlet_id_pk` PRIMARY KEY(`user_id`,`outlet_id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`name` varchar(191) NOT NULL,
	`email` varchar(191) NOT NULL,
	`phone` varchar(32),
	`password_hash` varchar(255),
	`pin_hash` varchar(255),
	`role_id` binary(16) NOT NULL,
	`locale` varchar(5),
	`status` varchar(16) NOT NULL DEFAULT 'active',
	`last_login_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	`active_email` varchar(191) GENERATED ALWAYS AS ((IF(`deleted_at` IS NULL, LOWER(`email`), NULL))) STORED,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_active_email_uq` UNIQUE(`active_email`)
);
--> statement-breakpoint
ALTER TABLE `outlets` ADD CONSTRAINT `outlets_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `role_privileges` ADD CONSTRAINT `role_privileges_role_id_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `roles` ADD CONSTRAINT `roles_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_outlets` ADD CONSTRAINT `user_outlets_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_outlets` ADD CONSTRAINT `user_outlets_outlet_id_outlets_id_fk` FOREIGN KEY (`outlet_id`) REFERENCES `outlets`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_role_id_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `outlets_business_idx` ON `outlets` (`business_id`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_user_idx` ON `refresh_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `roles_business_idx` ON `roles` (`business_id`);--> statement-breakpoint
CREATE INDEX `user_outlets_outlet_idx` ON `user_outlets` (`outlet_id`);--> statement-breakpoint
CREATE INDEX `users_business_idx` ON `users` (`business_id`);--> statement-breakpoint
CREATE INDEX `users_role_idx` ON `users` (`role_id`);