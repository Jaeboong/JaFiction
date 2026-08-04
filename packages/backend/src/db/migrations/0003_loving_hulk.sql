CREATE TABLE "synced_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"project_slug_hash" text,
	"content_sha256" text NOT NULL,
	"created_at_iso" text NOT NULL,
	"enc_payload" "bytea" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "synced_documents_user_id_scope_project_slug_hash_content_sha256_unique" UNIQUE("user_id","scope","project_slug_hash","content_sha256")
);
--> statement-breakpoint
CREATE TABLE "synced_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"slug_hash" text NOT NULL,
	"record_updated_at" timestamp NOT NULL,
	"enc_record" "bytea" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "synced_projects_user_id_slug_hash_unique" UNIQUE("user_id","slug_hash")
);
--> statement-breakpoint
ALTER TABLE "synced_documents" ADD CONSTRAINT "synced_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synced_projects" ADD CONSTRAINT "synced_projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;