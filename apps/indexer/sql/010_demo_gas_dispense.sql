-- 010_demo_gas_dispense.sql — eligibility ledger for the tBNB dispenser.
--
-- The dispenser sends a fixed 0.005 tBNB to a SIGNATURE-PROVEN address (the
-- route recovers the signer from a server-issued nonce; no request-body
-- address is ever trusted). This migration adds the address column and a
-- kind-scoped permit: PERMANENT one-dispense-per-address (not daily),
-- 1/IP/day, 8/global/day. The row is the dispense log (address, ip_hash,
-- created_at); the tx hash is logged to the runtime log by the route.
-- Same SECURITY DEFINER + anon posture as demo_action_permit: spam can only
-- exhaust counters, never move funds.

alter table public.demo_hires add column if not exists address text;
create index if not exists idx_demo_hires_addr on public.demo_hires (kind, address);

create or replace function public.demo_gas_permit(p_ip_hash text, p_address text)
returns table (allowed boolean, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_addr text := lower(p_address); v_ip int; v_global int;
begin
  if v_addr !~ '^0x[0-9a-f]{40}$' then return query select false, 'bad-address'::text; return; end if;
  perform pg_advisory_xact_lock(hashtext('demo_gas_permit'));

  if exists (select 1 from public.demo_hires where kind = 'gas' and address = v_addr) then
    return query select false, 'address-already-dispensed'::text; return;
  end if;
  select count(*) into v_ip from public.demo_hires
   where kind = 'gas' and ip_hash = p_ip_hash and created_at >= date_trunc('day', now());
  if v_ip >= 1 then return query select false, 'ip'::text; return; end if;
  select count(*) into v_global from public.demo_hires
   where kind = 'gas' and created_at >= date_trunc('day', now());
  if v_global >= 8 then return query select false, 'global'::text; return; end if;

  insert into public.demo_hires (ip_hash, agent_id, kind, address) values (p_ip_hash, 0, 'gas', v_addr);
  return query select true, 'ok'::text;
end $$;

revoke all on function public.demo_gas_permit(text, text) from public, authenticated;
grant execute on function public.demo_gas_permit(text, text) to anon, service_role;

-- Assertions ----------------------------------------------------------------
do $$
declare a boolean; r text;
begin
  select allowed, reason into a, r from public.demo_gas_permit('gas-probe-ip', '0x00000000000000000000000000000000000000AA');
  if not a then raise exception 'assert: first dispense should be allowed (%)', r; end if;
  select allowed, reason into a, r from public.demo_gas_permit('gas-probe-ip2', '0x00000000000000000000000000000000000000AA');
  if a or r <> 'address-already-dispensed' then raise exception 'assert: address must be permanent-once (%)', r; end if;
  select allowed, reason into a, r from public.demo_gas_permit('gas-probe-ip', '0x00000000000000000000000000000000000000BB');
  if a or r <> 'ip' then raise exception 'assert: per-IP 1/day (%)', r; end if;
  select allowed, reason into a, r from public.demo_gas_permit('gas-probe-ip3', 'not-an-address');
  if a or r <> 'bad-address' then raise exception 'assert: address validation (%)', r; end if;
  delete from public.demo_hires where kind = 'gas' and ip_hash like 'gas-probe-ip%';
end $$;
