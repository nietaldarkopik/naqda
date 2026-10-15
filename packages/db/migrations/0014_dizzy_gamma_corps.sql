ALTER TABLE `businesses` ADD `status` varchar(12) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `businesses` ADD `trial_ends_at` datetime(3);--> statement-breakpoint
ALTER TABLE `businesses` ADD `billing_interval` varchar(8);--> statement-breakpoint
ALTER TABLE `businesses` ADD `current_period_ends_at` datetime(3);--> statement-breakpoint
ALTER TABLE `businesses` ADD `suspended_at` datetime(3);--> statement-breakpoint
ALTER TABLE `businesses` ADD `suspend_reason` varchar(255);--> statement-breakpoint
ALTER TABLE `businesses` ADD `country` varchar(2);--> statement-breakpoint
ALTER TABLE `businesses` ADD `terms_accepted_at` datetime(3);--> statement-breakpoint
ALTER TABLE `businesses` ADD `terms_version` varchar(16);--> statement-breakpoint
ALTER TABLE `businesses` ADD `limits` json;--> statement-breakpoint
-- Bisnis yang sudah ada sebelum fitur paket tetap tanpa batas.
UPDATE `businesses` SET `plan` = 'unlimited' WHERE `plan` = 'basic';
