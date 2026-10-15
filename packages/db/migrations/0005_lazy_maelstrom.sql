CREATE TABLE `order_activities` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`outlet_id` binary(16) NOT NULL,
	`order_id` binary(16),
	`user_id` binary(16) NOT NULL,
	`approved_by` binary(16),
	`kind` varchar(24) NOT NULL,
	`detail` json,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `order_activities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `refund_items` (
	`id` binary(16) NOT NULL,
	`refund_id` binary(16) NOT NULL,
	`order_item_id` binary(16) NOT NULL,
	`quantity` int unsigned NOT NULL,
	`amount` bigint NOT NULL,
	CONSTRAINT `refund_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `refunds` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`outlet_id` binary(16) NOT NULL,
	`order_id` binary(16) NOT NULL,
	`shift_id` binary(16) NOT NULL,
	`user_id` binary(16) NOT NULL,
	`approved_by` binary(16),
	`method` varchar(24) NOT NULL,
	`total` bigint NOT NULL,
	`reason` varchar(255) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `refunds_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `table_groups` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`outlet_id` binary(16) NOT NULL,
	`name` varchar(120) NOT NULL,
	`position` smallint unsigned NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	`active_name` varchar(120) GENERATED ALWAYS AS ((IF(`deleted_at` IS NULL, `name`, NULL))) STORED,
	CONSTRAINT `table_groups_id` PRIMARY KEY(`id`),
	CONSTRAINT `table_groups_name_uq` UNIQUE(`outlet_id`,`active_name`)
);
--> statement-breakpoint
CREATE TABLE `tables` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`outlet_id` binary(16) NOT NULL,
	`group_id` binary(16),
	`name` varchar(120) NOT NULL,
	`capacity` smallint unsigned NOT NULL DEFAULT 2,
	`x` smallint unsigned NOT NULL DEFAULT 0,
	`y` smallint unsigned NOT NULL DEFAULT 0,
	`shape` varchar(8) NOT NULL DEFAULT 'rect',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	`active_name` varchar(120) GENERATED ALWAYS AS ((IF(`deleted_at` IS NULL, `name`, NULL))) STORED,
	CONSTRAINT `tables_id` PRIMARY KEY(`id`),
	CONSTRAINT `tables_name_uq` UNIQUE(`outlet_id`,`active_name`)
);
--> statement-breakpoint
ALTER TABLE `order_items` ADD `order_discount_share` bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `order_items` ADD `refunded_quantity` int unsigned DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `refunded_total` bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `order_activities` ADD CONSTRAINT `order_activities_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_activities` ADD CONSTRAINT `order_activities_outlet_id_outlets_id_fk` FOREIGN KEY (`outlet_id`) REFERENCES `outlets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_activities` ADD CONSTRAINT `order_activities_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_activities` ADD CONSTRAINT `order_activities_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_activities` ADD CONSTRAINT `order_activities_approved_by_users_id_fk` FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refund_items` ADD CONSTRAINT `refund_items_refund_id_refunds_id_fk` FOREIGN KEY (`refund_id`) REFERENCES `refunds`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refund_items` ADD CONSTRAINT `refund_items_order_item_id_order_items_id_fk` FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_outlet_id_outlets_id_fk` FOREIGN KEY (`outlet_id`) REFERENCES `outlets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_shift_id_shifts_id_fk` FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_approved_by_users_id_fk` FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `table_groups` ADD CONSTRAINT `table_groups_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `table_groups` ADD CONSTRAINT `table_groups_outlet_id_outlets_id_fk` FOREIGN KEY (`outlet_id`) REFERENCES `outlets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tables` ADD CONSTRAINT `tables_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tables` ADD CONSTRAINT `tables_outlet_id_outlets_id_fk` FOREIGN KEY (`outlet_id`) REFERENCES `outlets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tables` ADD CONSTRAINT `tables_group_id_table_groups_id_fk` FOREIGN KEY (`group_id`) REFERENCES `table_groups`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `order_activities_outlet_idx` ON `order_activities` (`outlet_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `order_activities_order_idx` ON `order_activities` (`order_id`);--> statement-breakpoint
CREATE INDEX `refund_items_refund_idx` ON `refund_items` (`refund_id`);--> statement-breakpoint
CREATE INDEX `refunds_order_idx` ON `refunds` (`order_id`);--> statement-breakpoint
CREATE INDEX `refunds_shift_idx` ON `refunds` (`shift_id`);--> statement-breakpoint
CREATE INDEX `refunds_outlet_idx` ON `refunds` (`outlet_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `tables_outlet_idx` ON `tables` (`outlet_id`);--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_table_id_tables_id_fk` FOREIGN KEY (`table_id`) REFERENCES `tables`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `orders_table_idx` ON `orders` (`table_id`,`status`);