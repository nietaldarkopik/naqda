ALTER TABLE `refunds` ADD `net_amount` bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `refunds` ADD `gratuity_amount` bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `refunds` ADD `tax_amount` bigint DEFAULT 0 NOT NULL;