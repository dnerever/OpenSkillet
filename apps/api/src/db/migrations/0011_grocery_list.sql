CREATE TABLE "grocery_imports" (
	"list_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grocery_imports_list_id_version_id_pk" PRIMARY KEY("list_id","version_id")
);
--> statement-breakpoint
CREATE TABLE "grocery_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL,
	"item" text NOT NULL,
	"amounts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unmeasured" boolean DEFAULT false NOT NULL,
	"unmeasured_note" text,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grocery_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "grocery_imports" ADD CONSTRAINT "grocery_imports_list_id_grocery_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."grocery_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grocery_imports" ADD CONSTRAINT "grocery_imports_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grocery_imports" ADD CONSTRAINT "grocery_imports_version_id_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grocery_items" ADD CONSTRAINT "grocery_items_list_id_grocery_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."grocery_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grocery_lists" ADD CONSTRAINT "grocery_lists_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "grocery_imports_recipe_idx" ON "grocery_imports" USING btree ("recipe_id");--> statement-breakpoint
CREATE UNIQUE INDEX "grocery_items_list_item_idx" ON "grocery_items" USING btree ("list_id",lower("item"));--> statement-breakpoint
CREATE INDEX "grocery_items_list_created_idx" ON "grocery_items" USING btree ("list_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "grocery_lists_owner_idx" ON "grocery_lists" USING btree ("owner_id");