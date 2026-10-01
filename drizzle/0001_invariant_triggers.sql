-- EL INVARIANTE (§6 de la spec)
--   SUM(entries.amount) = 0 por cada (transacción, moneda). Siempre, sin excepciones.
--
-- Las conversiones ARS<->USD usan cuentas de FX (Equity:FX:*) en lugar de precio
-- inline, justamente para que el invariante no tenga excepciones y pueda vivir
-- como constraint en la base.

CREATE OR REPLACE FUNCTION assert_balanced() RETURNS trigger AS $$
DECLARE
  tx_id uuid;
  bad record;
BEGIN
  -- NEW es NULL en DELETE y OLD es NULL en INSERT: se elige por TG_OP para no
  -- depender de cómo plpgsql resuelve un campo sobre un record nulo.
  IF TG_OP = 'DELETE' THEN
    tx_id := OLD.transaction_id;
  ELSE
    tx_id := NEW.transaction_id;
  END IF;

  SELECT e.transaction_id, e.currency, sum(e.amount) AS total INTO bad
  FROM entries e
  WHERE e.transaction_id = tx_id
  GROUP BY e.transaction_id, e.currency
  HAVING sum(e.amount) <> 0
  LIMIT 1;

  IF found THEN
    RAISE EXCEPTION 'Transacción % desbalanceada en %: %', bad.transaction_id, bad.currency, bad.total;
  END IF;

  RETURN NULL;
END $$ LANGUAGE plpgsql;

-- `deferrable initially deferred` es la clave: permite insertar las partidas de
-- a una dentro de una transacción y validar al COMMIT, con la transacción ya
-- completa. Sin esto, la primera partida de cualquier asiento fallaría.
CREATE CONSTRAINT TRIGGER entries_balanced
  AFTER INSERT OR UPDATE OR DELETE ON entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_balanced();

--> statement-breakpoint

-- Las dos reglas de integridad de `entries` que no quedan declarativas porque
-- requieren join a `accounts`:
--
--   1. entries.currency está desnormalizado a propósito (duplica
--      accounts.currency) para que el trigger del invariante no necesite join.
--      Un trigger chico valida que coincidan.
--   2. entries.envelope_id solo tiene sentido en cuentas `expense` (de qué
--      sobre salió) y en `income` para reembolsos.

CREATE OR REPLACE FUNCTION entries_validate_account() RETURNS trigger AS $$
DECLARE
  acct_currency currency;
  acct_type account_type;
  acct_name text;
BEGIN
  SELECT a.currency, a.type, a.name
    INTO acct_currency, acct_type, acct_name
  FROM accounts a
  WHERE a.id = NEW.account_id;

  IF NEW.currency <> acct_currency THEN
    RAISE EXCEPTION
      'La partida está en % pero la cuenta "%" es en % (una cuenta = una moneda)',
      NEW.currency, acct_name, acct_currency;
  END IF;

  IF NEW.envelope_id IS NOT NULL AND acct_type NOT IN ('expense', 'income') THEN
    RAISE EXCEPTION
      'La cuenta "%" es de tipo %: solo las partidas contra cuentas expense o income llevan sobre',
      acct_name, acct_type;
  END IF;

  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER entries_validate_account_trg
  BEFORE INSERT OR UPDATE OF account_id, currency, envelope_id ON entries
  FOR EACH ROW EXECUTE FUNCTION entries_validate_account();

--> statement-breakpoint

-- Las cuentas de sistema (Equity:Opening:*, Equity:FX:*) las maneja la app.
-- Solo pueden ser de tipo equity.
ALTER TABLE accounts
  ADD CONSTRAINT accounts_system_is_equity
  CHECK (NOT is_system OR type = 'equity');
