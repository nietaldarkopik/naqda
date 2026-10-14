CREATE TABLE `translations` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`entity_type` varchar(32) NOT NULL,
	`entity_id` binary(16) NOT NULL,
	`locale` varchar(5) NOT NULL,
	`field` varchar(32) NOT NULL,
	`value` varchar(500) NOT NULL,
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `translations_id` PRIMARY KEY(`id`),
	CONSTRAINT `translations_uq` UNIQUE(`entity_type`,`entity_id`,`locale`,`field`)
);
--> statement-breakpoint
ALTER TABLE `outlets` ADD `prices_include_tax` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `translations` ADD CONSTRAINT `translations_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `translations_business_idx` ON `translations` (`business_id`,`entity_type`);