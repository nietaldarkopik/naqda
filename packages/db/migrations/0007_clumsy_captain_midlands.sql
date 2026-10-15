CREATE TABLE `ingredient_recipe_lines` (
	`ingredient_id` binary(16) NOT NULL,
	`component_id` binary(16) NOT NULL,
	`quantity` bigint NOT NULL,
	CONSTRAINT `ingredient_recipe_lines_ingredient_id_component_id_pk` PRIMARY KEY(`ingredient_id`,`component_id`)
);
--> statement-breakpoint
CREATE TABLE `ingredients` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`name` varchar(191) NOT NULL,
	`kind` varchar(8) NOT NULL DEFAULT 'raw',
	`unit` varchar(16) NOT NULL,
	`category` varchar(120),
	`track_stock` boolean NOT NULL DEFAULT true,
	`yield_qty` bigint NOT NULL DEFAULT 1000,
	`default_cost` bigint NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	`active_name` varchar(191) GENERATED ALWAYS AS ((IF(`deleted_at` IS NULL, `name`, NULL))) STORED,
	CONSTRAINT `ingredients_id` PRIMARY KEY(`id`),
	CONSTRAINT `ingredients_name_uq` UNIQUE(`business_id`,`active_name`)
);
--> statement-breakpoint
CREATE TABLE `modifier_option_ingredients` (
	`option_id` binary(16) NOT NULL,
	`ingredient_id` binary(16) NOT NULL,
	`quantity` bigint NOT NULL,
	CONSTRAINT `modifier_option_ingredients_option_id_ingredient_id_pk` PRIMARY KEY(`option_id`,`ingredient_id`)
);
--> statement-breakpoint
CREATE TABLE `purchase_order_lines` (
	`id` binary(16) NOT NULL,
	`po_id` binary(16) NOT NULL,
	`subject_type` varchar(12) NOT NULL,
	`subject_id` binary(16) NOT NULL,
	`name` varchar(255) NOT NULL,
	`quantity` bigint NOT NULL,
	`unit_cost` bigint NOT NULL,
	`received_qty` bigint NOT NULL DEFAULT 0,
	CONSTRAINT `purchase_order_lines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`outlet_id` binary(16) NOT NULL,
	`supplier_id` binary(16),
	`number` int unsigned NOT NULL,
	`status` varchar(12) NOT NULL DEFAULT 'waiting',
	`note` varchar(500),
	`created_by` binary(16) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`completed_at` datetime(3),
	CONSTRAINT `purchase_orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `purchase_orders_number_uq` UNIQUE(`outlet_id`,`number`)
);
--> statement-breakpoint
CREATE TABLE `stock_adjustments` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`outlet_id` binary(16) NOT NULL,
	`number` int unsigned NOT NULL,
	`note` varchar(500),
	`value_change` bigint NOT NULL DEFAULT 0,
	`lines` json NOT NULL,
	`created_by` binary(16) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `stock_adjustments_id` PRIMARY KEY(`id`),
	CONSTRAINT `stock_adjustments_number_uq` UNIQUE(`outlet_id`,`number`)
);
--> statement-breakpoint
CREATE TABLE `stock_levels` (
	`outlet_id` binary(16) NOT NULL,
	`subject_type` varchar(12) NOT NULL,
	`subject_id` binary(16) NOT NULL,
	`quantity` bigint NOT NULL DEFAULT 0,
	`avg_cost` bigint NOT NULL DEFAULT 0,
	`alert_low` bigint NOT NULL DEFAULT 0,
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `stock_levels_outlet_id_subject_type_subject_id_pk` PRIMARY KEY(`outlet_id`,`subject_type`,`subject_id`)
);
--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`outlet_id` binary(16) NOT NULL,
	`subject_type` varchar(12) NOT NULL,
	`subject_id` binary(16) NOT NULL,
	`kind` varchar(20) NOT NULL,
	`delta` bigint NOT NULL,
	`unit_cost` bigint NOT NULL DEFAULT 0,
	`value` bigint NOT NULL DEFAULT 0,
	`balance_after` bigint NOT NULL DEFAULT 0,
	`ref_type` varchar(20),
	`ref_id` binary(16),
	`order_item_id` binary(16),
	`user_id` binary(16),
	`note` varchar(255),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `stock_movements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`name` varchar(191) NOT NULL,
	`phone` varchar(32),
	`email` varchar(191),
	`address` varchar(500),
	`city` varchar(120),
	`postal_code` varchar(16),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	`active_name` varchar(191) GENERATED ALWAYS AS ((IF(`deleted_at` IS NULL, `name`, NULL))) STORED,
	CONSTRAINT `suppliers_id` PRIMARY KEY(`id`),
	CONSTRAINT `suppliers_name_uq` UNIQUE(`business_id`,`active_name`)
);
--> statement-breakpoint
CREATE TABLE `transfer_lines` (
	`id` binary(16) NOT NULL,
	`transfer_id` binary(16) NOT NULL,
	`subject_type` varchar(12) NOT NULL,
	`subject_id` binary(16) NOT NULL,
	`name` varchar(255) NOT NULL,
	`quantity` bigint NOT NULL,
	`unit_cost` bigint NOT NULL DEFAULT 0,
	`received_qty` bigint NOT NULL DEFAULT 0,
	CONSTRAINT `transfer_lines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `transfers` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`from_outlet_id` binary(16) NOT NULL,
	`to_outlet_id` binary(16) NOT NULL,
	`number` int unsigned NOT NULL,
	`status` varchar(12) NOT NULL DEFAULT 'in_transit',
	`note` varchar(500),
	`created_by` binary(16) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`received_at` datetime(3),
	CONSTRAINT `transfers_id` PRIMARY KEY(`id`),
	CONSTRAINT `transfers_number_uq` UNIQUE(`from_outlet_id`,`number`)
);
--> statement-breakpoint
CREATE TABLE `variant_recipe_lines` (
	`variant_id` binary(16) NOT NULL,
	`ingredient_id` binary(16) NOT NULL,
	`quantity` bigint NOT NULL,
	CONSTRAINT `variant_recipe_lines_variant_id_ingredient_id_pk` PRIMARY KEY(`variant_id`,`ingredient_id`)
);
--> statement-breakpoint
ALTER TABLE `outlets` ADD `stock_mode` varchar(10) DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE `refunds` ADD `restock` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `ingredient_recipe_lines` ADD CONSTRAINT `ingredient_recipe_lines_ingredient_id_ingredients_id_fk` FOREIGN KEY (`ingredient_id`) REFERENCES `ingredients`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ingredient_recipe_lines` ADD CONSTRAINT `ingredient_recipe_lines_component_id_ingredients_id_fk` FOREIGN KEY (`component_id`) REFERENCES `ingredients`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ingredients` ADD CONSTRAINT `ingredients_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `modifier_option_ingredients` ADD CONSTRAINT `modifier_option_ingredients_option_id_modifier_options_id_fk` FOREIGN KEY (`option_id`) REFERENCES `modifier_options`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `modifier_option_ingredients` ADD CONSTRAINT `modifier_option_ingredients_ingredient_id_ingredients_id_fk` FOREIGN KEY (`ingredient_id`) REFERENCES `ingredients`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_order_lines` ADD CONSTRAINT `purchase_order_lines_po_id_purchase_orders_id_fk` FOREIGN KEY (`po_id`) REFERENCES `purchase_orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_outlet_id_outlets_id_fk` FOREIGN KEY (`outlet_id`) REFERENCES `outlets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_supplier_id_suppliers_id_fk` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_adjustments` ADD CONSTRAINT `stock_adjustments_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_adjustments` ADD CONSTRAINT `stock_adjustments_outlet_id_outlets_id_fk` FOREIGN KEY (`outlet_id`) REFERENCES `outlets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_adjustments` ADD CONSTRAINT `stock_adjustments_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_levels` ADD CONSTRAINT `stock_levels_outlet_id_outlets_id_fk` FOREIGN KEY (`outlet_id`) REFERENCES `outlets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_outlet_id_outlets_id_fk` FOREIGN KEY (`outlet_id`) REFERENCES `outlets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `suppliers` ADD CONSTRAINT `suppliers_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transfer_lines` ADD CONSTRAINT `transfer_lines_transfer_id_transfers_id_fk` FOREIGN KEY (`transfer_id`) REFERENCES `transfers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transfers` ADD CONSTRAINT `transfers_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transfers` ADD CONSTRAINT `transfers_from_outlet_id_outlets_id_fk` FOREIGN KEY (`from_outlet_id`) REFERENCES `outlets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transfers` ADD CONSTRAINT `transfers_to_outlet_id_outlets_id_fk` FOREIGN KEY (`to_outlet_id`) REFERENCES `outlets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transfers` ADD CONSTRAINT `transfers_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `variant_recipe_lines` ADD CONSTRAINT `variant_recipe_lines_variant_id_item_variants_id_fk` FOREIGN KEY (`variant_id`) REFERENCES `item_variants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `variant_recipe_lines` ADD CONSTRAINT `variant_recipe_lines_ingredient_id_ingredients_id_fk` FOREIGN KEY (`ingredient_id`) REFERENCES `ingredients`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `po_lines_po_idx` ON `purchase_order_lines` (`po_id`);--> statement-breakpoint
CREATE INDEX `purchase_orders_status_idx` ON `purchase_orders` (`outlet_id`,`status`);--> statement-breakpoint
CREATE INDEX `stock_adjustments_outlet_idx` ON `stock_adjustments` (`outlet_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `stock_levels_subject_idx` ON `stock_levels` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `stock_movements_outlet_idx` ON `stock_movements` (`outlet_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `stock_movements_subject_idx` ON `stock_movements` (`outlet_id`,`subject_type`,`subject_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `stock_movements_ref_idx` ON `stock_movements` (`ref_type`,`ref_id`);--> statement-breakpoint
CREATE INDEX `stock_movements_order_item_idx` ON `stock_movements` (`order_item_id`);--> statement-breakpoint
CREATE INDEX `transfer_lines_transfer_idx` ON `transfer_lines` (`transfer_id`);--> statement-breakpoint
CREATE INDEX `transfers_to_idx` ON `transfers` (`to_outlet_id`,`status`);--> statement-breakpoint
CREATE INDEX `variant_recipe_ingredient_idx` ON `variant_recipe_lines` (`ingredient_id`);