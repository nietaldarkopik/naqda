CREATE TABLE `cash_movements` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`shift_id` binary(16) NOT NULL,
	`kind` varchar(8) NOT NULL,
	`amount` bigint NOT NULL,
	`description` varchar(255) NOT NULL,
	`created_by` binary(16) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `cash_movements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `counters` (
	`outlet_id` binary(16) NOT NULL,
	`kind` varchar(24) NOT NULL,
	`value` bigint NOT NULL DEFAULT 0,
	CONSTRAINT `counters_outlet_id_kind_pk` PRIMARY KEY(`outlet_id`,`kind`)
);
--> statement-breakpoint
CREATE TABLE `devices` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`outlet_id` binary(16) NOT NULL,
	`name` varchar(120) NOT NULL,
	`activation_code_hash` varchar(64),
	`activation_expires_at` datetime(3),
	`token_hash` varchar(64),
	`activated_at` datetime(3),
	`last_seen_at` datetime(3),
	`revoked_at` datetime(3),
	`created_by` binary(16),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `devices_id` PRIMARY KEY(`id`),
	CONSTRAINT `devices_token_uq` UNIQUE(`token_hash`),
	CONSTRAINT `devices_code_uq` UNIQUE(`activation_code_hash`)
);
--> statement-breakpoint
CREATE TABLE `order_item_modifiers` (
	`id` binary(16) NOT NULL,
	`order_item_id` binary(16) NOT NULL,
	`option_id` binary(16),
	`name` varchar(191) NOT NULL,
	`price` bigint NOT NULL DEFAULT 0,
	CONSTRAINT `order_item_modifiers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`order_id` binary(16) NOT NULL,
	`position` smallint unsigned NOT NULL DEFAULT 0,
	`item_id` binary(16),
	`variant_id` binary(16),
	`bundle_id` binary(16),
	`category_id` binary(16),
	`name` varchar(255) NOT NULL,
	`sku` varchar(64),
	`unit_price` bigint NOT NULL,
	`base_price` bigint NOT NULL,
	`cost` bigint NOT NULL DEFAULT 0,
	`quantity` int unsigned NOT NULL,
	`discount` json,
	`line_discount` bigint NOT NULL DEFAULT 0,
	`promo_discount` bigint NOT NULL DEFAULT 0,
	`promo_id` binary(16),
	`note` varchar(255),
	`status` varchar(8) NOT NULL DEFAULT 'active',
	CONSTRAINT `order_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`outlet_id` binary(16) NOT NULL,
	`shift_id` binary(16) NOT NULL,
	`user_id` binary(16) NOT NULL,
	`device_id` binary(16),
	`sales_type_id` binary(16) NOT NULL,
	`table_id` binary(16),
	`customer_id` binary(16),
	`pax` smallint unsigned,
	`label` varchar(80),
	`note` varchar(500),
	`status` varchar(8) NOT NULL DEFAULT 'open',
	`receipt_number` int unsigned,
	`opened_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`paid_at` datetime(3),
	`voided_at` datetime(3),
	`void_reason` varchar(255),
	`order_discount` json,
	`pricing_snapshot` json,
	`subtotal` bigint NOT NULL DEFAULT 0,
	`discount_total` bigint NOT NULL DEFAULT 0,
	`base` bigint NOT NULL DEFAULT 0,
	`net` bigint NOT NULL DEFAULT 0,
	`gratuity` bigint NOT NULL DEFAULT 0,
	`tax` bigint NOT NULL DEFAULT 0,
	`rounding` bigint NOT NULL DEFAULT 0,
	`total` bigint NOT NULL DEFAULT 0,
	`paid_total` bigint NOT NULL DEFAULT 0,
	`change_given` bigint NOT NULL DEFAULT 0,
	CONSTRAINT `orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `orders_receipt_uq` UNIQUE(`outlet_id`,`receipt_number`)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`order_id` binary(16) NOT NULL,
	`shift_id` binary(16) NOT NULL,
	`method` varchar(24) NOT NULL,
	`tendered` bigint NOT NULL,
	`applied` bigint NOT NULL,
	`change_amount` bigint NOT NULL DEFAULT 0,
	`reference` varchar(120),
	`created_by` binary(16) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `payments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `receipt_outbox` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`order_id` binary(16) NOT NULL,
	`channel` varchar(8) NOT NULL,
	`destination` varchar(191) NOT NULL,
	`status` varchar(12) NOT NULL DEFAULT 'pending',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `receipt_outbox_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `shifts` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`outlet_id` binary(16) NOT NULL,
	`user_id` binary(16) NOT NULL,
	`device_id` binary(16),
	`opened_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`closed_at` datetime(3),
	`opening_cash` bigint NOT NULL DEFAULT 0,
	`expected_cash` bigint,
	`actual_cash` bigint,
	`difference` bigint,
	`note` varchar(500),
	`open_key` tinyint GENERATED ALWAYS AS ((IF(`closed_at` IS NULL, 1, NULL))) STORED,
	CONSTRAINT `shifts_id` PRIMARY KEY(`id`),
	CONSTRAINT `shifts_one_open_uq` UNIQUE(`outlet_id`,`user_id`,`open_key`)
);
--> statement-breakpoint
ALTER TABLE `outlets` ADD `prices_include_gratuity` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `outlets` ADD `tax_on_gratuity` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `outlets` ADD `rounding_step` int unsigned DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `outlets` ADD `rounding_mode` varchar(8) DEFAULT 'nearest' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `pin_failures` int unsigned DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `pin_locked_until` datetime(3);--> statement-breakpoint
ALTER TABLE `cash_movements` ADD CONSTRAINT `cash_movements_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cash_movements` ADD CONSTRAINT `cash_movements_shift_id_shifts_id_fk` FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cash_movements` ADD CONSTRAINT `cash_movements_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `counters` ADD CONSTRAINT `counters_outlet_id_outlets_id_fk` FOREIGN KEY (`outlet_id`) REFERENCES `outlets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `devices` ADD CONSTRAINT `devices_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `devices` ADD CONSTRAINT `devices_outlet_id_outlets_id_fk` FOREIGN KEY (`outlet_id`) REFERENCES `outlets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `devices` ADD CONSTRAINT `devices_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_item_modifiers` ADD CONSTRAINT `order_item_modifiers_order_item_id_order_items_id_fk` FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_item_modifiers` ADD CONSTRAINT `order_item_modifiers_option_id_modifier_options_id_fk` FOREIGN KEY (`option_id`) REFERENCES `modifier_options`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_item_id_items_id_fk` FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_variant_id_item_variants_id_fk` FOREIGN KEY (`variant_id`) REFERENCES `item_variants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_outlet_id_outlets_id_fk` FOREIGN KEY (`outlet_id`) REFERENCES `outlets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_shift_id_shifts_id_fk` FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_device_id_devices_id_fk` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_sales_type_id_sales_types_id_fk` FOREIGN KEY (`sales_type_id`) REFERENCES `sales_types`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_shift_id_shifts_id_fk` FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `receipt_outbox` ADD CONSTRAINT `receipt_outbox_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `receipt_outbox` ADD CONSTRAINT `receipt_outbox_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shifts` ADD CONSTRAINT `shifts_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shifts` ADD CONSTRAINT `shifts_outlet_id_outlets_id_fk` FOREIGN KEY (`outlet_id`) REFERENCES `outlets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shifts` ADD CONSTRAINT `shifts_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shifts` ADD CONSTRAINT `shifts_device_id_devices_id_fk` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `cash_movements_shift_idx` ON `cash_movements` (`shift_id`);--> statement-breakpoint
CREATE INDEX `devices_outlet_idx` ON `devices` (`outlet_id`);--> statement-breakpoint
CREATE INDEX `order_item_modifiers_item_idx` ON `order_item_modifiers` (`order_item_id`);--> statement-breakpoint
CREATE INDEX `order_items_order_idx` ON `order_items` (`order_id`,`position`);--> statement-breakpoint
CREATE INDEX `orders_outlet_status_idx` ON `orders` (`outlet_id`,`status`,`opened_at`);--> statement-breakpoint
CREATE INDEX `orders_shift_idx` ON `orders` (`shift_id`);--> statement-breakpoint
CREATE INDEX `payments_order_idx` ON `payments` (`order_id`);--> statement-breakpoint
CREATE INDEX `payments_shift_idx` ON `payments` (`shift_id`);--> statement-breakpoint
CREATE INDEX `receipt_outbox_order_idx` ON `receipt_outbox` (`order_id`);--> statement-breakpoint
CREATE INDEX `shifts_outlet_idx` ON `shifts` (`outlet_id`,`opened_at`);