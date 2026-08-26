-- Utility contract numbers ("מספר חוזה") per property.
--
-- Every apartment has its own account with the electric company, the water
-- corporation, the gas supplier and the municipality (ארנונה). The number is
-- what you must quote to report a meter reading, move the account to an
-- incoming tenant, or ask about a bill — so it belongs on the property, next
-- to its address, not in someone's phone.
--
-- text, not numeric: these are identifiers, not quantities (leading zeros and
-- dashes are common, and they are never summed).
alter table public.properties
  add column if not exists electricity_contract_number text,
  add column if not exists water_contract_number text,
  add column if not exists gas_contract_number text,
  add column if not exists arnona_contract_number text;
