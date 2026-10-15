CREATE TABLE `invoice_proofs` (
	`id` binary(16) NOT NULL,
	`invoice_id` binary(16) NOT NULL,
	`bank` varchar(80) NOT NULL,
	`sender` varchar(120) NOT NULL,
	`transferred_on` varchar(10) NOT NULL,
	`note` varchar(255),
	`image_type` varchar(20),
	`image` mediumblob,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `invoice_proofs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` binary(16) NOT NULL,
	`business_id` binary(16) NOT NULL,
	`number` varchar(24) NOT NULL,
	`plan` varchar(20) NOT NULL,
	`interval` varchar(8) NOT NULL,
	`amount` bigint NOT NULL,
	`currency` varchar(3) NOT NULL,
	`status` varchar(8) NOT NULL DEFAULT 'open',
	`provider` varchar(20) NOT NULL DEFAULT 'manual_transfer',
	`external_ref` varchar(191),
	`due_at` datetime(3),
	`paid_at` datetime(3),
	`reviewed_by` binary(16),
	`reject_reason` varchar(255),
	`custom` bigint NOT NULL DEFAULT 0,
	`note` varchar(255),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `invoices_id` PRIMARY KEY(`id`),
	CONSTRAINT `invoices_number_uq` UNIQUE(`number`)
);
--> statement-breakpoint
ALTER TABLE `invoice_proofs` ADD CONSTRAINT `invoice_proofs_invoice_id_invoices_id_fk` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_reviewed_by_platform_admins_id_fk` FOREIGN KEY (`reviewed_by`) REFERENCES `platform_admins`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `invoice_proofs_invoice_idx` ON `invoice_proofs` (`invoice_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `invoices_business_idx` ON `invoices` (`business_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `invoices_status_idx` ON `invoices` (`status`,`created_at`);