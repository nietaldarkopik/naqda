CREATE TABLE `discount_categories` (
	`discount_id` binary(16) NOT NULL,
	`category_id` binary(16) NOT NULL,
	CONSTRAINT `discount_categories_discount_id_category_id_pk` PRIMARY KEY(`discount_id`,`category_id`)
);
--> statement-breakpoint
CREATE TABLE `discount_items` (
	`discount_id` binary(16) NOT NULL,
	`item_id` binary(16) NOT NULL,
	CONSTRAINT `discount_items_discount_id_item_id_pk` PRIMARY KEY(`discount_id`,`item_id`)
);
--> statement-breakpoint
ALTER TABLE `outlets` ADD `discount_mode` varchar(12) DEFAULT 'sequential' NOT NULL;--> statement-breakpoint
ALTER TABLE `discounts` ADD `scope` varchar(8) DEFAULT 'order' NOT NULL;--> statement-breakpoint
ALTER TABLE `discount_categories` ADD CONSTRAINT `discount_categories_discount_id_discounts_id_fk` FOREIGN KEY (`discount_id`) REFERENCES `discounts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `discount_categories` ADD CONSTRAINT `discount_categories_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `discount_items` ADD CONSTRAINT `discount_items_discount_id_discounts_id_fk` FOREIGN KEY (`discount_id`) REFERENCES `discounts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `discount_items` ADD CONSTRAINT `discount_items_item_id_items_id_fk` FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE cascade ON UPDATE no action;