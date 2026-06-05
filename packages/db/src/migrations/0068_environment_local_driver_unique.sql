DROP INDEX IF EXISTS "environments_squad_driver_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "environments_squad_driver_idx" ON "environments" USING btree ("squad_id","driver") WHERE "driver" = 'local';
