ALTER TABLE "devices" ALTER COLUMN "workspace_root" DROP NOT NULL;
ALTER TABLE "devices" ADD COLUMN "hostname" TEXT;
ALTER TABLE "devices" ADD COLUMN "os" TEXT;
ALTER TABLE "devices" ADD COLUMN "runner_version" TEXT;
