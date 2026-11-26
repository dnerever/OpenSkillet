ALTER TABLE "grocery_imports" ADD COLUMN "scale_key" text DEFAULT '1.0000' NOT NULL;--> statement-breakpoint
ALTER TABLE "grocery_imports" DROP CONSTRAINT "grocery_imports_list_id_version_id_pk";--> statement-breakpoint
ALTER TABLE "grocery_imports" ADD CONSTRAINT "grocery_imports_list_id_version_id_scale_key_pk" PRIMARY KEY("list_id","version_id","scale_key");