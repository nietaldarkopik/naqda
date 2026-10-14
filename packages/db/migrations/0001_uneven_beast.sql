CREATE TABLE `audit_logs` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`user_id` binary(16),
	`entity_type` varchar(40) NOT NULL,
	`entity_id` binary(16),
	`action` varchar(24) NOT NULL,
	`summary` varchar(500),
	`changes` json,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `brands` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`name` varchar(191) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	`active_name` varchar(191) GENERATED ALWAYS AS ((IF(`deleted_at` IS NULL, `name`, NULL))) STORED,
	CONSTRAINT `brands_id` PRIMARY KEY(`id`),
	CONSTRAINT `brands_name_uq` UNIQUE(`business_id`,`active_name`)
);
--> statement-breakpoint
CREATE TABLE `bundle_items` (
	`bundle_id` binary(16) NOT NULL,
	`variant_id` binary(16) NOT NULL,
	`quantity` smallint unsigned NOT NULL DEFAULT 1,
	CONSTRAINT `bundle_items_bundle_id_variant_id_pk` PRIMARY KEY(`bundle_id`,`variant_id`)
);
--> statement-breakpoint
CREATE TABLE `bundle_outlets` (
	`bundle_id` binary(16) NOT NULL,
	`outlet_id` binary(16) NOT NULL,
	CONSTRAINT `bundle_outlets_bundle_id_outlet_id_pk` PRIMARY KEY(`bundle_id`,`outlet_id`)
);
--> statement-breakpoint
CREATE TABLE `bundle_prices` (
	`bundle_id` binary(16) NOT NULL,
	`sales_type_id` binary(16) NOT NULL,
	`price` bigint NOT NULL,
	CONSTRAINT `bundle_prices_bundle_id_sales_type_id_pk` PRIMARY KEY(`bundle_id`,`sales_type_id`)
);
--> statement-breakpoint
CREATE TABLE `bundles` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`name` varchar(191) NOT NULL,
	`price` bigint NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'active',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	`active_name` varchar(191) GENERATED ALWAYS AS ((IF(`deleted_at` IS NULL, `name`, NULL))) STORED,
	CONSTRAINT `bundles_id` PRIMARY KEY(`id`),
	CONSTRAINT `bundles_name_uq` UNIQUE(`business_id`,`active_name`)
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`name` varchar(191) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	`active_name` varchar(191) GENERATED ALWAYS AS ((IF(`deleted_at` IS NULL, `name`, NULL))) STORED,
	CONSTRAINT `categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `categories_name_uq` UNIQUE(`business_id`,`active_name`)
);
--> statement-breakpoint
CREATE TABLE `discount_outlets` (
	`discount_id` binary(16) NOT NULL,
	`outlet_id` binary(16) NOT NULL,
	CONSTRAINT `discount_outlets_discount_id_outlet_id_pk` PRIMARY KEY(`discount_id`,`outlet_id`)
);
--> statement-breakpoint
CREATE TABLE `discounts` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`name` varchar(191) NOT NULL,
	`kind` varchar(16) NOT NULL,
	`value` bigint NOT NULL,
	`customizable` boolean NOT NULL DEFAULT false,
	`status` varchar(16) NOT NULL DEFAULT 'active',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	`active_name` varchar(191) GENERATED ALWAYS AS ((IF(`deleted_at` IS NULL, `name`, NULL))) STORED,
	CONSTRAINT `discounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `discounts_name_uq` UNIQUE(`business_id`,`active_name`)
);
--> statement-breakpoint
CREATE TABLE `gratuities` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`name` varchar(191) NOT NULL,
	`rate_bp` int NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	`active_name` varchar(191) GENERATED ALWAYS AS ((IF(`deleted_at` IS NULL, `name`, NULL))) STORED,
	CONSTRAINT `gratuities_id` PRIMARY KEY(`id`),
	CONSTRAINT `gratuities_name_uq` UNIQUE(`business_id`,`active_name`)
);
--> statement-breakpoint
CREATE TABLE `gratuity_outlets` (
	`gratuity_id` binary(16) NOT NULL,
	`outlet_id` binary(16) NOT NULL,
	CONSTRAINT `gratuity_outlets_gratuity_id_outlet_id_pk` PRIMARY KEY(`gratuity_id`,`outlet_id`)
);
--> statement-breakpoint
CREATE TABLE `item_modifier_sets` (
	`item_id` binary(16) NOT NULL,
	`set_id` binary(16) NOT NULL,
	`position` smallint unsigned NOT NULL DEFAULT 0,
	CONSTRAINT `item_modifier_sets_item_id_set_id_pk` PRIMARY KEY(`item_id`,`set_id`)
);
--> statement-breakpoint
CREATE TABLE `item_outlets` (
	`item_id` binary(16) NOT NULL,
	`outlet_id` binary(16) NOT NULL,
	`available` boolean NOT NULL DEFAULT true,
	CONSTRAINT `item_outlets_item_id_outlet_id_pk` PRIMARY KEY(`item_id`,`outlet_id`)
);
--> statement-breakpoint
CREATE TABLE `item_variant_prices` (
	`variant_id` binary(16) NOT NULL,
	`sales_type_id` binary(16) NOT NULL,
	`price` bigint NOT NULL,
	CONSTRAINT `item_variant_prices_variant_id_sales_type_id_pk` PRIMARY KEY(`variant_id`,`sales_type_id`)
);
--> statement-breakpoint
CREATE TABLE `item_variants` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`item_id` binary(16) NOT NULL,
	`name` varchar(191) NOT NULL,
	`sku` varchar(64),
	`base_price` bigint NOT NULL,
	`cost` bigint NOT NULL DEFAULT 0,
	`position` smallint unsigned NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	`active_sku` varchar(64) GENERATED ALWAYS AS ((IF(`deleted_at` IS NULL, `sku`, NULL))) STORED,
	CONSTRAINT `item_variants_id` PRIMARY KEY(`id`),
	CONSTRAINT `item_variants_sku_uq` UNIQUE(`business_id`,`active_sku`)
);
--> statement-breakpoint
CREATE TABLE `items` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`category_id` binary(16),
	`brand_id` binary(16),
	`name` varchar(191) NOT NULL,
	`description` varchar(1000),
	`image_url` varchar(500),
	`track_stock` boolean NOT NULL DEFAULT false,
	`status` varchar(16) NOT NULL DEFAULT 'active',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `modifier_options` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`set_id` binary(16) NOT NULL,
	`name` varchar(191) NOT NULL,
	`price` bigint NOT NULL DEFAULT 0,
	`position` smallint unsigned NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `modifier_options_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `modifier_sets` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`name` varchar(191) NOT NULL,
	`min_select` tinyint unsigned NOT NULL DEFAULT 0,
	`max_select` tinyint unsigned,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	`active_name` varchar(191) GENERATED ALWAYS AS ((IF(`deleted_at` IS NULL, `name`, NULL))) STORED,
	CONSTRAINT `modifier_sets_id` PRIMARY KEY(`id`),
	CONSTRAINT `modifier_sets_name_uq` UNIQUE(`business_id`,`active_name`)
);
--> statement-breakpoint
CREATE TABLE `promo_outlets` (
	`promo_id` binary(16) NOT NULL,
	`outlet_id` binary(16) NOT NULL,
	CONSTRAINT `promo_outlets_promo_id_outlet_id_pk` PRIMARY KEY(`promo_id`,`outlet_id`)
);
--> statement-breakpoint
CREATE TABLE `promo_sales_types` (
	`promo_id` binary(16) NOT NULL,
	`sales_type_id` binary(16) NOT NULL,
	CONSTRAINT `promo_sales_types_promo_id_sales_type_id_pk` PRIMARY KEY(`promo_id`,`sales_type_id`)
);
--> statement-breakpoint
CREATE TABLE `promos` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`name` varchar(191) NOT NULL,
	`type` varchar(24) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'active',
	`starts_at` datetime(3),
	`ends_at` datetime(3),
	`hours` json,
	`weekdays` json,
	`multiple` boolean NOT NULL DEFAULT false,
	`requirement_scope` varchar(16) NOT NULL,
	`requirement_item_id` binary(16),
	`requirement_category_id` binary(16),
	`requirement_quantity` smallint unsigned NOT NULL DEFAULT 1,
	`reward_kind` varchar(16) NOT NULL,
	`reward_value` bigint NOT NULL DEFAULT 0,
	`reward_item_id` binary(16),
	`reward_quantity` smallint unsigned NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	`active_name` varchar(191) GENERATED ALWAYS AS ((IF(`deleted_at` IS NULL, `name`, NULL))) STORED,
	CONSTRAINT `promos_id` PRIMARY KEY(`id`),
	CONSTRAINT `promos_name_uq` UNIQUE(`business_id`,`active_name`)
);
--> statement-breakpoint
CREATE TABLE `sales_type_gratuities` (
	`sales_type_id` binary(16) NOT NULL,
	`gratuity_id` binary(16) NOT NULL,
	CONSTRAINT `sales_type_gratuities_sales_type_id_gratuity_id_pk` PRIMARY KEY(`sales_type_id`,`gratuity_id`)
);
--> statement-breakpoint
CREATE TABLE `sales_types` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`name` varchar(191) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'active',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	`active_name` varchar(191) GENERATED ALWAYS AS ((IF(`deleted_at` IS NULL, `name`, NULL))) STORED,
	CONSTRAINT `sales_types_id` PRIMARY KEY(`id`),
	CONSTRAINT `sales_types_name_uq` UNIQUE(`business_id`,`active_name`)
);
--> statement-breakpoint
CREATE TABLE `tax_outlets` (
	`tax_id` binary(16) NOT NULL,
	`outlet_id` binary(16) NOT NULL,
	CONSTRAINT `tax_outlets_tax_id_outlet_id_pk` PRIMARY KEY(`tax_id`,`outlet_id`)
);
--> statement-breakpoint
CREATE TABLE `taxes` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`name` varchar(191) NOT NULL,
	`rate_bp` int NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	`active_name` varchar(191) GENERATED ALWAYS AS ((IF(`deleted_at` IS NULL, `name`, NULL))) STORED,
	CONSTRAINT `taxes_id` PRIMARY KEY(`id`),
	CONSTRAINT `taxes_name_uq` UNIQUE(`business_id`,`active_name`)
);
--> statement-breakpoint
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `brands` ADD CONSTRAINT `brands_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bundle_items` ADD CONSTRAINT `bundle_items_bundle_id_bundles_id_fk` FOREIGN KEY (`bundle_id`) REFERENCES `bundles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bundle_items` ADD CONSTRAINT `bundle_items_variant_id_item_variants_id_fk` FOREIGN KEY (`variant_id`) REFERENCES `item_variants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bundle_outlets` ADD CONSTRAINT `bundle_outlets_bundle_id_bundles_id_fk` FOREIGN KEY (`bundle_id`) REFERENCES `bundles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bundle_outlets` ADD CONSTRAINT `bundle_outlets_outlet_id_outlets_id_fk` FOREIGN KEY (`outlet_id`) REFERENCES `outlets`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bundle_prices` ADD CONSTRAINT `bundle_prices_bundle_id_bundles_id_fk` FOREIGN KEY (`bundle_id`) REFERENCES `bundles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bundle_prices` ADD CONSTRAINT `bundle_prices_sales_type_id_sales_types_id_fk` FOREIGN KEY (`sales_type_id`) REFERENCES `sales_types`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bundles` ADD CONSTRAINT `bundles_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `categories` ADD CONSTRAINT `categories_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `discount_outlets` ADD CONSTRAINT `discount_outlets_discount_id_discounts_id_fk` FOREIGN KEY (`discount_id`) REFERENCES `discounts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `discount_outlets` ADD CONSTRAINT `discount_outlets_outlet_id_outlets_id_fk` FOREIGN KEY (`outlet_id`) REFERENCES `outlets`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `discounts` ADD CONSTRAINT `discounts_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `gratuities` ADD CONSTRAINT `gratuities_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `gratuity_outlets` ADD CONSTRAINT `gratuity_outlets_gratuity_id_gratuities_id_fk` FOREIGN KEY (`gratuity_id`) REFERENCES `gratuities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `gratuity_outlets` ADD CONSTRAINT `gratuity_outlets_outlet_id_outlets_id_fk` FOREIGN KEY (`outlet_id`) REFERENCES `outlets`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `item_modifier_sets` ADD CONSTRAINT `item_modifier_sets_item_id_items_id_fk` FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `item_modifier_sets` ADD CONSTRAINT `item_modifier_sets_set_id_modifier_sets_id_fk` FOREIGN KEY (`set_id`) REFERENCES `modifier_sets`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `item_outlets` ADD CONSTRAINT `item_outlets_item_id_items_id_fk` FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `item_outlets` ADD CONSTRAINT `item_outlets_outlet_id_outlets_id_fk` FOREIGN KEY (`outlet_id`) REFERENCES `outlets`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `item_variant_prices` ADD CONSTRAINT `item_variant_prices_variant_id_item_variants_id_fk` FOREIGN KEY (`variant_id`) REFERENCES `item_variants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `item_variant_prices` ADD CONSTRAINT `item_variant_prices_sales_type_id_sales_types_id_fk` FOREIGN KEY (`sales_type_id`) REFERENCES `sales_types`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `item_variants` ADD CONSTRAINT `item_variants_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `item_variants` ADD CONSTRAINT `item_variants_item_id_items_id_fk` FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `items` ADD CONSTRAINT `items_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `items` ADD CONSTRAINT `items_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `items` ADD CONSTRAINT `items_brand_id_brands_id_fk` FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `modifier_options` ADD CONSTRAINT `modifier_options_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `modifier_options` ADD CONSTRAINT `modifier_options_set_id_modifier_sets_id_fk` FOREIGN KEY (`set_id`) REFERENCES `modifier_sets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `modifier_sets` ADD CONSTRAINT `modifier_sets_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `promo_outlets` ADD CONSTRAINT `promo_outlets_promo_id_promos_id_fk` FOREIGN KEY (`promo_id`) REFERENCES `promos`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `promo_outlets` ADD CONSTRAINT `promo_outlets_outlet_id_outlets_id_fk` FOREIGN KEY (`outlet_id`) REFERENCES `outlets`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `promo_sales_types` ADD CONSTRAINT `promo_sales_types_promo_id_promos_id_fk` FOREIGN KEY (`promo_id`) REFERENCES `promos`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `promo_sales_types` ADD CONSTRAINT `promo_sales_types_sales_type_id_sales_types_id_fk` FOREIGN KEY (`sales_type_id`) REFERENCES `sales_types`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `promos` ADD CONSTRAINT `promos_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `promos` ADD CONSTRAINT `promos_requirement_item_id_items_id_fk` FOREIGN KEY (`requirement_item_id`) REFERENCES `items`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `promos` ADD CONSTRAINT `promos_requirement_category_id_categories_id_fk` FOREIGN KEY (`requirement_category_id`) REFERENCES `categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `promos` ADD CONSTRAINT `promos_reward_item_id_items_id_fk` FOREIGN KEY (`reward_item_id`) REFERENCES `items`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sales_type_gratuities` ADD CONSTRAINT `sales_type_gratuities_sales_type_id_sales_types_id_fk` FOREIGN KEY (`sales_type_id`) REFERENCES `sales_types`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sales_type_gratuities` ADD CONSTRAINT `sales_type_gratuities_gratuity_id_gratuities_id_fk` FOREIGN KEY (`gratuity_id`) REFERENCES `gratuities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sales_types` ADD CONSTRAINT `sales_types_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tax_outlets` ADD CONSTRAINT `tax_outlets_tax_id_taxes_id_fk` FOREIGN KEY (`tax_id`) REFERENCES `taxes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tax_outlets` ADD CONSTRAINT `tax_outlets_outlet_id_outlets_id_fk` FOREIGN KEY (`outlet_id`) REFERENCES `outlets`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `taxes` ADD CONSTRAINT `taxes_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `audit_business_time_idx` ON `audit_logs` (`business_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_logs` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `item_outlets_outlet_idx` ON `item_outlets` (`outlet_id`);--> statement-breakpoint
CREATE INDEX `item_variants_item_idx` ON `item_variants` (`item_id`);--> statement-breakpoint
CREATE INDEX `items_business_idx` ON `items` (`business_id`,`name`);--> statement-breakpoint
CREATE INDEX `items_category_idx` ON `items` (`category_id`);--> statement-breakpoint
CREATE INDEX `modifier_options_set_idx` ON `modifier_options` (`set_id`);