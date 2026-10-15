ALTER TABLE `item_variants` ADD `barcode` varchar(64);--> statement-breakpoint
ALTER TABLE `item_variants` ADD `active_barcode` varchar(64) GENERATED ALWAYS AS ((IF(`deleted_at` IS NULL, `barcode`, NULL))) STORED;--> statement-breakpoint
ALTER TABLE `item_variants` ADD CONSTRAINT `item_variants_barcode_uq` UNIQUE(`business_id`,`active_barcode`);