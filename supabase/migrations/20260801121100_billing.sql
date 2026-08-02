-- =============================================================================
-- DoctorCita · Fase 1 · 12 — Planes, suscripciones, pagos y facturas
-- =============================================================================
-- La arquitectura queda lista para Stripe / Mercado Pago / OpenPay sin acoplarse
-- a ninguno: `provider` + `provider_*_id` guardan la referencia externa.
-- El estado de la suscripción controla la visibilidad pública del médico.
-- =============================================================================

create type public.subscription_status as enum (
  'trialing', 'active', 'past_due', 'cancelled', 'expired', 'paused'
);

create type public.payment_status as enum (
  'pending', 'processing', 'succeeded', 'failed', 'refunded', 'partially_refunded'
);

create type public.payment_method as enum (
  'card', 'spei', 'oxxo', 'paypal', 'cash', 'transfer'
);

create type public.billing_interval as enum ('month', 'year');

-- -----------------------------------------------------------------------------
-- plans
-- -----------------------------------------------------------------------------
create table public.plans (
  id               smallint generated always as identity primary key,
  key              text not null unique,
  name             text not null,
  description      text,

  price_cents      integer not null,
  currency         char(3) not null default 'MXN',
  billing_interval public.billing_interval not null default 'month',
  trial_days       smallint not null default 0,

  -- Límites del plan. null = ilimitado.
  max_consulting_rooms smallint,
  max_photos           smallint,
  max_services         smallint,

  -- Funcionalidades incluidas: {"telemedicine":true,"analytics":false,...}
  features         jsonb not null default '{}'::jsonb,

  display_order    smallint not null default 100,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),

  constraint plans_price_non_negative check (price_cents >= 0)
);

comment on table public.plans is 'Planes de suscripción para médicos (PRD Fase 9).';

insert into public.plans
  (key, name, description, price_cents, billing_interval, trial_days,
   max_consulting_rooms, max_photos, max_services, features, display_order)
values
  ('basic', 'Básico',
   'Perfil público, agenda en línea y un consultorio.',
   49900, 'month', 14, 1, 5, 10,
   '{"telemedicine": false, "analytics": false, "featured_listing": false, "chat": false}'::jsonb,
   1),
  ('professional', 'Profesional',
   'Hasta 3 consultorios, telemedicina y chat con pacientes.',
   99900, 'month', 14, 3, 20, 40,
   '{"telemedicine": true, "analytics": true, "featured_listing": false, "chat": true}'::jsonb,
   2),
  ('premium', 'Premium',
   'Consultorios ilimitados, posición destacada y reportes avanzados.',
   179900, 'month', 14, null, null, null,
   '{"telemedicine": true, "analytics": true, "featured_listing": true, "chat": true}'::jsonb,
   3);

-- -----------------------------------------------------------------------------
-- subscriptions
-- -----------------------------------------------------------------------------
create table public.subscriptions (
  id                   uuid primary key default gen_random_uuid(),
  doctor_id            uuid not null references public.doctors(id) on delete cascade,
  plan_id              smallint not null references public.plans(id) on delete restrict,

  status               public.subscription_status not null default 'trialing',

  current_period_start timestamptz not null default now(),
  current_period_end   timestamptz not null,
  trial_ends_at        timestamptz,
  cancel_at_period_end boolean not null default false,
  cancelled_at         timestamptz,

  -- Referencia al proveedor de pagos, sin acoplarse a ninguno.
  provider             text,            -- 'stripe' | 'mercadopago' | 'openpay' | 'manual'
  provider_customer_id text,
  provider_subscription_id text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint subscriptions_period_order check (current_period_end > current_period_start)
);

comment on table public.subscriptions is
  'Suscripción del médico. Su estado activa o desactiva la visibilidad pública.';

create index subscriptions_doctor_idx on public.subscriptions (doctor_id, created_at desc);
create index subscriptions_status_idx on public.subscriptions (status);
create index subscriptions_renewal_idx on public.subscriptions (current_period_end)
  where status in ('active', 'trialing');

-- Una única suscripción vigente por médico.
create unique index subscriptions_one_active_per_doctor
  on public.subscriptions (doctor_id)
  where status in ('trialing', 'active', 'past_due');

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

create trigger subscriptions_audit
  after insert or update or delete on public.subscriptions
  for each row execute function public.audit_row();

-- -----------------------------------------------------------------------------
-- Visibilidad automática del médico según su suscripción
-- -----------------------------------------------------------------------------
-- Este trigger es el que conecta Fase 9 con Fase 5: en cuanto la suscripción
-- deja de estar vigente, el perfil desaparece del buscador público.
create or replace function public.sync_doctor_subscription_flag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doctor_id uuid := coalesce(new.doctor_id, old.doctor_id);
  v_active    boolean;
begin
  select exists (
    select 1 from public.subscriptions s
    where s.doctor_id = v_doctor_id
      and s.status in ('trialing', 'active')
      and s.current_period_end > now()
  ) into v_active;

  perform public.begin_internal_write();

  update public.doctors
     set has_active_subscription = v_active
   where id = v_doctor_id
     and has_active_subscription is distinct from v_active;

  perform public.end_internal_write();
  return coalesce(new, old);
end;
$$;

create trigger subscriptions_sync_doctor_flag
  after insert or update or delete on public.subscriptions
  for each row execute function public.sync_doctor_subscription_flag();

-- -----------------------------------------------------------------------------
-- payments
-- -----------------------------------------------------------------------------
create table public.payments (
  id                  uuid primary key default gen_random_uuid(),

  -- Un pago es de una suscripción (médico) o de una cita (paciente).
  subscription_id     uuid references public.subscriptions(id) on delete set null,
  appointment_id      uuid references public.appointments(id) on delete set null,
  payer_user_id       uuid not null references public.users(id) on delete restrict,

  amount_cents        integer not null,
  currency            char(3) not null default 'MXN',
  status              public.payment_status not null default 'pending',
  method              public.payment_method,

  provider            text,
  provider_payment_id text,
  -- Respuesta cruda del proveedor, para depurar discrepancias.
  provider_payload    jsonb,

  paid_at             timestamptz,
  failed_at           timestamptz,
  failure_reason      text,
  refunded_cents      integer not null default 0,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint payments_amount_positive check (amount_cents > 0),
  constraint payments_refund_within_amount check (
    refunded_cents >= 0 and refunded_cents <= amount_cents
  ),
  -- Debe estar ligado a algo.
  constraint payments_has_target check (
    subscription_id is not null or appointment_id is not null
  )
);

comment on table public.payments is 'Pagos de suscripciones y de citas (PRD Fase 9).';

create index payments_subscription_idx on public.payments (subscription_id);
create index payments_appointment_idx  on public.payments (appointment_id);
create index payments_payer_idx        on public.payments (payer_user_id, created_at desc);
create unique index payments_provider_id_uniq on public.payments (provider, provider_payment_id)
  where provider_payment_id is not null;

create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

create trigger payments_audit
  after insert or update or delete on public.payments
  for each row execute function public.audit_row();

-- -----------------------------------------------------------------------------
-- invoices
-- -----------------------------------------------------------------------------
create table public.invoices (
  id             uuid primary key default gen_random_uuid(),
  payment_id     uuid references public.payments(id) on delete set null,
  user_id        uuid not null references public.users(id) on delete restrict,

  folio          text not null unique,

  subtotal_cents integer not null,
  tax_cents      integer not null default 0,
  total_cents    integer not null,
  currency       char(3) not null default 'MXN',

  -- Datos fiscales mexicanos (CFDI)
  rfc            text,
  legal_name     text,
  tax_regime     text,
  cfdi_use       text,
  cfdi_uuid      text unique,
  pdf_url        text,
  xml_url        text,

  issued_at      timestamptz not null default now(),
  created_at     timestamptz not null default now(),

  constraint invoices_totals_coherent check (total_cents = subtotal_cents + tax_cents),
  constraint invoices_rfc_format check (
    rfc is null or rfc ~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$'
  )
);

comment on table public.invoices is 'Comprobantes fiscales (CFDI) de los pagos.';

create index invoices_user_idx on public.invoices (user_id, issued_at desc);

create sequence public.invoice_folio_seq;

create or replace function public.generate_invoice_folio()
returns trigger
language plpgsql
as $$
begin
  if new.folio is null or new.folio = '' then
    new.folio := 'FA-' || to_char(now(), 'YYYY') || '-' ||
                 lpad(nextval('public.invoice_folio_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

create trigger invoices_generate_folio
  before insert on public.invoices
  for each row execute function public.generate_invoice_folio();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.plans         enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payments      enable row level security;
alter table public.invoices      enable row level security;

-- Los planes son públicos: la página de precios los muestra sin sesión.
create policy "plans_select_all"
  on public.plans for select
  to anon, authenticated
  using (is_active or public.is_admin());

create policy "plans_write_admin"
  on public.plans for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- El médico ve su suscripción pero NO la escribe: eso lo hace el webhook del
-- proveedor de pagos vía service_role, que ignora RLS. Permitir escritura desde
-- el cliente sería permitir activarse gratis.
create policy "subscriptions_select_own"
  on public.subscriptions for select
  to authenticated
  using (doctor_id = public.current_doctor_id() or public.is_admin());

create policy "subscriptions_write_admin"
  on public.subscriptions for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "payments_select_own"
  on public.payments for select
  to authenticated
  using (payer_user_id = auth.uid() or public.is_admin());

create policy "payments_write_admin"
  on public.payments for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "invoices_select_own"
  on public.invoices for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy "invoices_write_admin"
  on public.invoices for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
