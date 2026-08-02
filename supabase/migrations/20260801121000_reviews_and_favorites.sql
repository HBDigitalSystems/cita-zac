-- =============================================================================
-- DoctorCita · Fase 1 · 11 — Reseñas y favoritos
-- =============================================================================
-- Regla de negocio del PRD: solo se puede reseñar tras una cita COMPLETADA, y
-- una sola vez por cita. Se aplica con constraint + trigger, no solo en la UI.
-- =============================================================================

create type public.review_status as enum ('pending', 'published', 'hidden', 'removed');

-- -----------------------------------------------------------------------------
-- reviews
-- -----------------------------------------------------------------------------
create table public.reviews (
  id             uuid primary key default gen_random_uuid(),

  -- Una reseña por cita: es lo que la hace "verificada".
  appointment_id uuid not null unique references public.appointments(id) on delete cascade,
  patient_id     uuid not null references public.patients(id) on delete cascade,
  doctor_id      uuid not null references public.doctors(id) on delete cascade,

  rating         smallint not null,
  comment        text,

  -- Desglose opcional (PRD Fase 8)
  rating_punctuality smallint,
  rating_attention   smallint,
  rating_facilities  smallint,

  status         public.review_status not null default 'published',
  is_anonymous   boolean not null default false,

  -- Respuesta del médico
  doctor_reply       text,
  doctor_replied_at  timestamptz,

  -- Moderación
  moderated_by       uuid references public.users(id) on delete set null,
  moderated_at       timestamptz,
  moderation_reason  text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint reviews_rating_range check (rating between 1 and 5),
  constraint reviews_sub_ratings_range check (
    (rating_punctuality is null or rating_punctuality between 1 and 5) and
    (rating_attention   is null or rating_attention   between 1 and 5) and
    (rating_facilities  is null or rating_facilities  between 1 and 5)
  )
);

comment on table public.reviews is
  'Reseñas verificadas: ligadas 1:1 a una cita completada (PRD Fase 8).';

create index reviews_doctor_idx on public.reviews (doctor_id, created_at desc)
  where status = 'published';
create index reviews_patient_idx on public.reviews (patient_id);

create trigger reviews_set_updated_at
  before update on public.reviews
  for each row execute function public.set_updated_at();

create trigger reviews_audit
  after insert or update or delete on public.reviews
  for each row execute function public.audit_row();

-- -----------------------------------------------------------------------------
-- Solo se reseña una cita completada
-- -----------------------------------------------------------------------------
create or replace function public.enforce_review_requires_completed_appointment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status     public.appointment_status;
  v_patient_id uuid;
  v_doctor_id  uuid;
  v_required   boolean;
begin
  select a.status, a.patient_id, a.doctor_id
    into v_status, v_patient_id, v_doctor_id
  from public.appointments a
  where a.id = new.appointment_id;

  if not found then
    raise exception 'La cita referenciada no existe.' using errcode = '23503';
  end if;

  -- Coherencia: la reseña debe pertenecer a los mismos actores que la cita.
  if new.patient_id is distinct from v_patient_id
     or new.doctor_id is distinct from v_doctor_id then
    raise exception 'La reseña no coincide con el paciente o el médico de la cita.'
      using errcode = '23514';
  end if;

  select coalesce((value)::boolean, true)
    into v_required
  from public.settings where key = 'reviews.require_completed';

  if coalesce(v_required, true) and v_status <> 'completed' then
    raise exception 'Solo se puede reseñar una cita completada (estado actual: %).', v_status
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger reviews_require_completed_appointment
  before insert on public.reviews
  for each row execute function public.enforce_review_requires_completed_appointment();

-- -----------------------------------------------------------------------------
-- Sincronización de la calificación del médico
-- -----------------------------------------------------------------------------
create or replace function public.sync_doctor_rating()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doctor_id uuid := coalesce(new.doctor_id, old.doctor_id);
begin
  perform public.begin_internal_write();

  update public.doctors d
     set rating_average = coalesce(agg.avg_rating, 0),
         reviews_count  = coalesce(agg.total, 0)
    from (
      select round(avg(rating)::numeric, 2) as avg_rating,
             count(*)                       as total
      from public.reviews
      where doctor_id = v_doctor_id
        and status = 'published'
    ) agg
   where d.id = v_doctor_id;

  perform public.end_internal_write();
  return coalesce(new, old);
end;
$$;

create trigger reviews_sync_doctor_rating
  after insert or update or delete on public.reviews
  for each row execute function public.sync_doctor_rating();

-- -----------------------------------------------------------------------------
-- review_reports — denuncias de reseñas abusivas
-- -----------------------------------------------------------------------------
create table public.review_reports (
  id          uuid primary key default gen_random_uuid(),
  review_id   uuid not null references public.reviews(id) on delete cascade,
  reported_by uuid not null references public.users(id) on delete cascade,
  reason      text not null,
  resolved_at timestamptz,
  resolved_by uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),

  unique (review_id, reported_by)
);

comment on table public.review_reports is 'Denuncias de reseñas para moderación (PRD Fase 8).';

create index review_reports_unresolved_idx on public.review_reports (created_at desc)
  where resolved_at is null;

-- -----------------------------------------------------------------------------
-- favorites — médicos guardados por el paciente
-- -----------------------------------------------------------------------------
create table public.favorites (
  patient_id uuid not null references public.patients(id) on delete cascade,
  doctor_id  uuid not null references public.doctors(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (patient_id, doctor_id)
);

comment on table public.favorites is 'Médicos guardados por el paciente (PRD Fase 5).';

create index favorites_doctor_idx on public.favorites (doctor_id);

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.reviews        enable row level security;
alter table public.review_reports enable row level security;
alter table public.favorites      enable row level security;

-- Las reseñas publicadas son públicas: son el activo de confianza del producto.
create policy "reviews_select_published"
  on public.reviews for select
  to anon, authenticated
  using (status = 'published');

create policy "reviews_select_own"
  on public.reviews for select
  to authenticated
  using (
    patient_id = public.current_patient_id()
    or doctor_id = public.current_doctor_id()
  );

create policy "reviews_insert_patient"
  on public.reviews for insert
  to authenticated
  with check (patient_id = public.current_patient_id());

-- El paciente edita su reseña. El trigger de columnas protegidas impide que
-- toque el estado de moderación.
create policy "reviews_update_patient"
  on public.reviews for update
  to authenticated
  using (patient_id = public.current_patient_id())
  with check (patient_id = public.current_patient_id());

-- El médico solo puede responder, no alterar la calificación.
create policy "reviews_update_doctor_reply"
  on public.reviews for update
  to authenticated
  using (doctor_id = public.current_doctor_id())
  with check (doctor_id = public.current_doctor_id());

create policy "reviews_all_admin"
  on public.reviews for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Blindaje: ni el paciente ni el médico pueden manipular calificación/estado
-- fuera de lo que les corresponde.
create or replace function public.protect_review_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    return new;
  end if;

  -- El médico solo puede tocar su respuesta.
  if old.doctor_id = public.current_doctor_id()
     and old.patient_id is distinct from public.current_patient_id() then
    if new.rating  is distinct from old.rating
       or new.comment is distinct from old.comment
       or new.status  is distinct from old.status then
      raise exception 'El médico solo puede responder a la reseña, no modificarla.'
        using errcode = '42501';
    end if;
    if new.doctor_reply is distinct from old.doctor_reply then
      new.doctor_replied_at := now();
    end if;
  end if;

  -- El paciente no puede auto-moderarse.
  if old.patient_id = public.current_patient_id() then
    if new.status is distinct from old.status
       or new.moderated_by is distinct from old.moderated_by
       or new.doctor_reply is distinct from old.doctor_reply then
      raise exception 'Campo de moderación protegido.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger reviews_protect_columns
  before update on public.reviews
  for each row execute function public.protect_review_columns();

create policy "review_reports_insert_authenticated"
  on public.review_reports for insert
  to authenticated
  with check (reported_by = auth.uid());

create policy "review_reports_select_own"
  on public.review_reports for select
  to authenticated
  using (reported_by = auth.uid() or public.is_admin());

create policy "review_reports_manage_admin"
  on public.review_reports for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "favorites_manage_own"
  on public.favorites for all
  to authenticated
  using (patient_id = public.current_patient_id())
  with check (patient_id = public.current_patient_id());
