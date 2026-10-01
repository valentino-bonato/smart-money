CREATE TYPE "public"."account_type" AS ENUM('asset', 'liability', 'income', 'expense', 'equity');--> statement-breakpoint
CREATE TYPE "public"."contribution_rule" AS ENUM('fixed', 'deadline', 'remainder', 'percent');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('ARS', 'USD');--> statement-breakpoint
CREATE TYPE "public"."envelope_kind" AS ENUM('spending', 'goal');--> statement-breakpoint
CREATE TYPE "public"."income_tier" AS ENUM('base', 'recurring_variable', 'milestone');--> statement-breakpoint
CREATE TYPE "public"."inflow_status" AS ENUM('expected', 'received', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('draft', 'approved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."rollover_mode" AS ENUM('accumulate', 'reset');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "account_type" NOT NULL,
	"currency" "currency" NOT NULL,
	"institution" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"archived_at" date,
	"display_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "accounts_user_name" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE TABLE "allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"envelope_id" uuid NOT NULL,
	"date" date NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"currency" "currency" NOT NULL,
	"plan_id" uuid,
	"note" text,
	CONSTRAINT "allocations_amount_nonzero" CHECK ("allocations"."amount" <> 0)
);
--> statement-breakpoint
CREATE TABLE "entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"currency" "currency" NOT NULL,
	"envelope_id" uuid,
	CONSTRAINT "entries_amount_nonzero" CHECK ("entries"."amount" <> 0)
);
--> statement-breakpoint
CREATE TABLE "envelopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "envelope_kind" NOT NULL,
	"rollover" "rollover_mode" NOT NULL,
	"archived_at" date,
	"display_order" integer DEFAULT 0 NOT NULL,
	"target_amount" numeric(20, 4),
	"target_currency" "currency",
	"target_date" date,
	"deadline_hard" boolean DEFAULT false NOT NULL,
	"contribution_rule" "contribution_rule",
	"contribution_amount" numeric(20, 4),
	CONSTRAINT "envelopes_user_name" UNIQUE("user_id","name"),
	CONSTRAINT "envelopes_target_currency_pair" CHECK (("envelopes"."target_amount" is null) = ("envelopes"."target_currency" is null))
);
--> statement-breakpoint
CREATE TABLE "expected_inflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"income_source_id" uuid NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"currency" "currency" NOT NULL,
	"expected_date" date,
	"confidence" numeric(5, 4),
	"status" "inflow_status" DEFAULT 'expected' NOT NULL,
	"received_transaction_id" uuid
);
--> statement-breakpoint
CREATE TABLE "income_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"tier" "income_tier" NOT NULL,
	"expected_amount" numeric(20, 4),
	"currency" "currency" NOT NULL,
	"day_of_month" integer,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "income_sources_user_name" UNIQUE("user_id","name"),
	CONSTRAINT "income_sources_day_of_month_range" CHECK ("income_sources"."day_of_month" is null or ("income_sources"."day_of_month" between 1 and 28))
);
--> statement-breakpoint
CREATE TABLE "plan_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"envelope_id" uuid,
	"account_id" uuid,
	"amount" numeric(20, 4) NOT NULL,
	"currency" "currency" NOT NULL,
	"tier" "income_tier" NOT NULL,
	"rule_applied" text,
	"sequence" integer NOT NULL,
	CONSTRAINT "plan_lines_plan_sequence" UNIQUE("plan_id","sequence"),
	CONSTRAINT "plan_lines_target_exactly_one" CHECK (("plan_lines"."envelope_id" is null) <> ("plan_lines"."account_id" is null))
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"period" date NOT NULL,
	"status" "plan_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	CONSTRAINT "plans_user_period" UNIQUE("user_id","period")
);
--> statement-breakpoint
CREATE TABLE "prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"base" "currency" NOT NULL,
	"quote" "currency" NOT NULL,
	"rate" numeric(20, 6) NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "prices_date_base_quote_source" UNIQUE("date","base","quote","source"),
	CONSTRAINT "prices_base_not_quote" CHECK ("prices"."base" <> "prices"."quote")
);
--> statement-breakpoint
CREATE TABLE "reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"date" date NOT NULL,
	"statement_balance" numeric(20, 4) NOT NULL,
	"computed_balance" numeric(20, 4) NOT NULL,
	"difference" numeric(20, 4) NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "recurring_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"account_id" uuid NOT NULL,
	"expense_account_id" uuid NOT NULL,
	"envelope_id" uuid NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"currency" "currency" NOT NULL,
	"day_of_month" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "recurring_expenses_user_name" UNIQUE("user_id","name"),
	CONSTRAINT "recurring_expenses_day_of_month_range" CHECK ("recurring_expenses"."day_of_month" between 1 and 28)
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"description" text,
	"payee" text,
	"plan_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_envelope_id_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."envelopes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_envelope_id_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."envelopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envelopes" ADD CONSTRAINT "envelopes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expected_inflows" ADD CONSTRAINT "expected_inflows_income_source_id_income_sources_id_fk" FOREIGN KEY ("income_source_id") REFERENCES "public"."income_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expected_inflows" ADD CONSTRAINT "expected_inflows_received_transaction_id_transactions_id_fk" FOREIGN KEY ("received_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_sources" ADD CONSTRAINT "income_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_lines" ADD CONSTRAINT "plan_lines_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_lines" ADD CONSTRAINT "plan_lines_envelope_id_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."envelopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_lines" ADD CONSTRAINT "plan_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_expense_account_id_accounts_id_fk" FOREIGN KEY ("expense_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_envelope_id_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."envelopes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "allocations_envelope_idx" ON "allocations" USING btree ("envelope_id","currency");--> statement-breakpoint
CREATE INDEX "allocations_plan_idx" ON "allocations" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "entries_transaction_idx" ON "entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "entries_account_idx" ON "entries" USING btree ("account_id","currency");--> statement-breakpoint
CREATE INDEX "entries_envelope_idx" ON "entries" USING btree ("envelope_id","currency");--> statement-breakpoint
CREATE INDEX "prices_lookup_idx" ON "prices" USING btree ("base","quote","date");--> statement-breakpoint
CREATE INDEX "transactions_user_date_idx" ON "transactions" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "transactions_payee_idx" ON "transactions" USING btree ("user_id","payee");--> statement-breakpoint
CREATE INDEX "transactions_plan_idx" ON "transactions" USING btree ("plan_id");