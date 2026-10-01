ALTER TABLE "envelopes" ADD COLUMN "contribution_currency" "currency";--> statement-breakpoint
-- Backfill antes del check: los sobres que ya tenían aporte lo tenían en la
-- moneda del objetivo (las metas, en USD) o en ARS (los sobres de gasto), que
-- era la inferencia que esta columna viene a reemplazar.
UPDATE "envelopes"
   SET "contribution_currency" = COALESCE("target_currency", 'ARS')
 WHERE "contribution_amount" IS NOT NULL
   AND "contribution_currency" IS NULL;--> statement-breakpoint
ALTER TABLE "envelopes" ADD CONSTRAINT "envelopes_contribution_currency_pair" CHECK (("envelopes"."contribution_amount" is null) = ("envelopes"."contribution_currency" is null));