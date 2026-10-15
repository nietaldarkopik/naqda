CREATE TABLE `customers` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`name` varchar(191) NOT NULL,
	`phone` varchar(32),
	`email` varchar(191),
	`note` varchar(500),
	`member_since` datetime(3),
	`bonus_granted` boolean NOT NULL DEFAULT false,
	`points` bigint NOT NULL DEFAULT 0,
	`lifetime_spending` bigint NOT NULL DEFAULT 0,
	`visits` int unsigned NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	`active_phone` varchar(32) GENERATED ALWAYS AS ((IF(`deleted_at` IS NULL, `phone`, NULL))) STORED,
	`active_email` varchar(191) GENERATED ALWAYS AS ((IF(`deleted_at` IS NULL, `email`, NULL))) STORED,
	CONSTRAINT `customers_id` PRIMARY KEY(`id`),
	CONSTRAINT `customers_phone_uq` UNIQUE(`business_id`,`active_phone`),
	CONSTRAINT `customers_email_uq` UNIQUE(`business_id`,`active_email`)
);
--> statement-breakpoint
CREATE TABLE `feedback` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`outlet_id` binary(16) NOT NULL,
	`order_id` binary(16),
	`customer_id` binary(16),
	`rating` varchar(4) NOT NULL,
	`comment` varchar(1000),
	`reply` varchar(1000),
	`replied_by` binary(16),
	`replied_at` datetime(3),
	`created_by` binary(16),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `feedback_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `loyalty_codes` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`customer_id` binary(16) NOT NULL,
	`reward_id` binary(16) NOT NULL,
	`code_hash` varchar(64) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`used_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `loyalty_codes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `loyalty_earn_rules` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`item_id` binary(16),
	`category_id` binary(16),
	`points_per_unit` int unsigned NOT NULL,
	CONSTRAINT `loyalty_earn_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `loyalty_ledger` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`customer_id` binary(16) NOT NULL,
	`kind` varchar(12) NOT NULL,
	`points` bigint NOT NULL,
	`balance_after` bigint NOT NULL,
	`order_id` binary(16),
	`reward_id` binary(16),
	`note` varchar(255),
	`created_by` binary(16),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `loyalty_ledger_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `loyalty_programs` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`point_mode` varchar(8) NOT NULL DEFAULT 'spend',
	`spend_amount` bigint NOT NULL DEFAULT 10000,
	`spend_points` int unsigned NOT NULL DEFAULT 1,
	`bonus_new_member` int unsigned NOT NULL DEFAULT 0,
	`member_quota` int unsigned,
	`valid_from` varchar(10),
	`valid_to` varchar(10),
	`require_code` boolean NOT NULL DEFAULT false,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `loyalty_programs_id` PRIMARY KEY(`id`),
	CONSTRAINT `loyalty_programs_business_uq` UNIQUE(`business_id`)
);
--> statement-breakpoint
CREATE TABLE `loyalty_redemptions` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`customer_id` binary(16) NOT NULL,
	`reward_id` binary(16) NOT NULL,
	`order_id` binary(16) NOT NULL,
	`points` int unsigned NOT NULL,
	`discount` bigint NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `loyalty_redemptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `loyalty_redemptions_order_uq` UNIQUE(`order_id`)
);
--> statement-breakpoint
CREATE TABLE `loyalty_rewards` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`name` varchar(191) NOT NULL,
	`points_cost` int unsigned NOT NULL,
	`kind` varchar(16) NOT NULL,
	`value_kind` varchar(8) NOT NULL,
	`value` bigint NOT NULL,
	`max_discount` bigint,
	`min_purchase` bigint NOT NULL DEFAULT 0,
	`item_id` binary(16),
	`category_id` binary(16),
	`status` varchar(16) NOT NULL DEFAULT 'active',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `loyalty_rewards_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sms_outbox` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`customer_id` binary(16),
	`phone` varchar(32) NOT NULL,
	`kind` varchar(20) NOT NULL,
	`body` varchar(500) NOT NULL,
	`status` varchar(12) NOT NULL DEFAULT 'logged',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `sms_outbox_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `orders` ADD `reward_id` binary(16);--> statement-breakpoint
ALTER TABLE `orders` ADD `points_earned` int unsigned DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `points_redeemed` int unsigned DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `customers` ADD CONSTRAINT `customers_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `feedback` ADD CONSTRAINT `feedback_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `feedback` ADD CONSTRAINT `feedback_outlet_id_outlets_id_fk` FOREIGN KEY (`outlet_id`) REFERENCES `outlets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `feedback` ADD CONSTRAINT `feedback_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `feedback` ADD CONSTRAINT `feedback_replied_by_users_id_fk` FOREIGN KEY (`replied_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `feedback` ADD CONSTRAINT `feedback_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_codes` ADD CONSTRAINT `loyalty_codes_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_codes` ADD CONSTRAINT `loyalty_codes_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_codes` ADD CONSTRAINT `loyalty_codes_reward_id_loyalty_rewards_id_fk` FOREIGN KEY (`reward_id`) REFERENCES `loyalty_rewards`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_earn_rules` ADD CONSTRAINT `loyalty_earn_rules_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_earn_rules` ADD CONSTRAINT `loyalty_earn_rules_item_id_items_id_fk` FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_earn_rules` ADD CONSTRAINT `loyalty_earn_rules_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_ledger` ADD CONSTRAINT `loyalty_ledger_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_ledger` ADD CONSTRAINT `loyalty_ledger_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_ledger` ADD CONSTRAINT `loyalty_ledger_reward_id_loyalty_rewards_id_fk` FOREIGN KEY (`reward_id`) REFERENCES `loyalty_rewards`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_ledger` ADD CONSTRAINT `loyalty_ledger_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_programs` ADD CONSTRAINT `loyalty_programs_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_redemptions` ADD CONSTRAINT `loyalty_redemptions_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_redemptions` ADD CONSTRAINT `loyalty_redemptions_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_redemptions` ADD CONSTRAINT `loyalty_redemptions_reward_id_loyalty_rewards_id_fk` FOREIGN KEY (`reward_id`) REFERENCES `loyalty_rewards`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_rewards` ADD CONSTRAINT `loyalty_rewards_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_rewards` ADD CONSTRAINT `loyalty_rewards_item_id_items_id_fk` FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_rewards` ADD CONSTRAINT `loyalty_rewards_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sms_outbox` ADD CONSTRAINT `sms_outbox_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sms_outbox` ADD CONSTRAINT `sms_outbox_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `customers_name_idx` ON `customers` (`business_id`,`name`);--> statement-breakpoint
CREATE INDEX `feedback_business_idx` ON `feedback` (`business_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `feedback_outlet_idx` ON `feedback` (`outlet_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `loyalty_codes_customer_idx` ON `loyalty_codes` (`customer_id`,`reward_id`);--> statement-breakpoint
CREATE INDEX `loyalty_earn_rules_business_idx` ON `loyalty_earn_rules` (`business_id`);--> statement-breakpoint
CREATE INDEX `loyalty_ledger_customer_idx` ON `loyalty_ledger` (`customer_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `loyalty_ledger_order_idx` ON `loyalty_ledger` (`order_id`);--> statement-breakpoint
CREATE INDEX `loyalty_redemptions_business_idx` ON `loyalty_redemptions` (`business_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `loyalty_rewards_business_idx` ON `loyalty_rewards` (`business_id`);--> statement-breakpoint
CREATE INDEX `sms_outbox_business_idx` ON `sms_outbox` (`business_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_reward_id_loyalty_rewards_id_fk` FOREIGN KEY (`reward_id`) REFERENCES `loyalty_rewards`(`id`) ON DELETE no action ON UPDATE no action;