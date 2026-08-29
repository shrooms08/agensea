create table if not exists bazaar_resources (
  resource_url   text primary key,
  resource_type  text,
  x402_version   int,
  description    text,
  last_updated   timestamptz,
  first_seen_at  timestamptz not null default now(),
  last_synced_at timestamptz not null default now(),
  raw            jsonb not null
);

create table if not exists bazaar_accepts (
  id                  bigserial primary key,
  resource_url        text not null references bazaar_resources(resource_url) on delete cascade,
  scheme              text,
  network             text,
  asset               text,
  max_amount_required numeric,
  pay_to              text,
  unique (resource_url, scheme, network, asset)
);

create index if not exists idx_accepts_payto on bazaar_accepts (pay_to);
create index if not exists idx_accepts_asset on bazaar_accepts (asset);
create index if not exists idx_resources_host on bazaar_resources ((split_part(resource_url,'/',3)));

create or replace view bazaar_payee_concentration as
  select pay_to,
         count(distinct resource_url) as resources,
         round(100.0 * count(distinct resource_url)
               / nullif((select count(*) from bazaar_resources),0), 2) as pct_of_catalogue
  from bazaar_accepts
  group by pay_to
  order by resources desc;
