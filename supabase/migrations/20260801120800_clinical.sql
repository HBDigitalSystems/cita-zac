-- =============================================================================
-- DoctorCita · Fase 1 · 09 — Expediente clínico, recetas y documentos
-- =============================================================================
-- Datos sensibles de salud. El RLS aquí es más estricto que en el resto del
-- esquema: NI SIQUIERA los administradores generales leen el contenido clínico.
-- Solo el paciente dueño y el médico tratante.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- medical_records — nota clínica por consulta
-- -----------------------------------------------------------------------------
create table public.medical_records (
  id               uuid primary key default gen_random_uuid(),
  appointment_id   uuid unique references public.appointments(id) on delete set null,
  patient_id       uuid not null references public.patients(id) on delete cascade,
  doctor_id        uuid not null references public.doctors(id) on delete restrict,

  -- Nota clínica
  chief_complaint  text,          -- motivo de consulta
  history          text,          -- padecimiento actual
  physical_exam    text,
  diagnosis        text,
  icd10_codes      text[] not null default '{}',
  treatment_plan   text,
  notes            text,
  follow_up_date   date,

  -- Signos vitales. jsonb en vez de 8 columnas porque el conjunto varía por
  -- especialidad (un pediatra registra percentiles, un cardiólogo no).
  vitals           jsonb not null default '{}'::jsonb,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.medical_records is
  'Nota clínica por consulta. Acceso restringido a paciente y médico tratante.';
comment on column public.medical_records.vitals is
  'Signos vitales en jsonb: {"weight_kg":70,"height_cm":175,"bp_systolic":120,...}';

create index medical_records_patient_idx on public.medical_records (patient_id, created_at desc);
create index medical_records_doctor_idx  on public.medical_records (doctor_id, created_at desc);

create trigger medical_records_set_updated_at
  before update on public.medical_records
  for each row execute function public.set_updated_at();

create trigger medical_records_audit
  after insert or update or delete on public.medical_records
  for each row execute function public.audit_row();

-- -----------------------------------------------------------------------------
-- prescriptions — receta médica
-- -----------------------------------------------------------------------------
create table public.prescriptions (
  id                uuid primary key default gen_random_uuid(),
  medical_record_id uuid references public.medical_records(id) on delete cascade,
  appointment_id    uuid references public.appointments(id) on delete set null,
  patient_id        uuid not null references public.patients(id) on delete cascade,
  doctor_id         uuid not null references public.doctors(id) on delete restrict,

  -- Folio legible e irrepetible de la receta.
  folio             text not null unique,

  instructions      text,
  diagnosis         text,
  issued_at         timestamptz not null default now(),
  valid_until       date,

  -- PDF generado y firmado (Storage). Se conserva el hash para detectar
  -- alteraciones de un documento con validez sanitaria.
  pdf_url           text,
  pdf_sha256        text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.prescriptions is 'Receta médica digital (PRD Fase 7).';

create index prescriptions_patient_idx on public.prescriptions (patient_id, issued_at desc);
create index prescriptions_doctor_idx  on public.prescriptions (doctor_id, issued_at desc);

create trigger prescriptions_set_updated_at
  before update on public.prescriptions
  for each row execute function public.set_updated_at();

create trigger prescriptions_audit
  after insert or update or delete on public.prescriptions
  for each row execute function public.audit_row();

create sequence public.prescription_folio_seq;

create or replace function public.generate_prescription_folio()
returns trigger
language plpgsql
as $$
begin
  if new.folio is null or new.folio = '' then
    new.folio := 'RX-' || to_char(now(), 'YYYY') || '-' ||
                 lpad(nextval('public.prescription_folio_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

create trigger prescriptions_generate_folio
  before insert on public.prescriptions
  for each row execute function public.generate_prescription_folio();

-- -----------------------------------------------------------------------------
-- prescription_items — medicamentos de la receta
-- -----------------------------------------------------------------------------
create table public.prescription_items (
  id               uuid primary key default gen_random_uuid(),
  prescription_id  uuid not null references public.prescriptions(id) on delete cascade,

  drug_name        text not null,
  presentation     text,          -- "Tabletas 500 mg"
  dosage           text,          -- "1 tableta"
  frequency        text,          -- "cada 8 horas"
  duration         text,          -- "7 días"
  quantity         text,
  notes            text,
  display_order    smallint not null default 100
);

comment on table public.prescription_items is 'Medicamentos individuales de una receta.';

create index prescription_items_prescription_idx
  on public.prescription_items (prescription_id, display_order);

-- -----------------------------------------------------------------------------
-- documents — archivos clínicos del paciente
-- -----------------------------------------------------------------------------
create type public.document_type as enum (
  'lab_result', 'imaging', 'prescription', 'referral',
  'consent', 'insurance', 'identification', 'other'
);

create table public.documents (
  id                uuid primary key default gen_random_uuid(),
  patient_id        uuid not null references public.patients(id) on delete cascade,

  -- Quién lo subió: el propio paciente o un médico.
  uploaded_by       uuid not null references public.users(id) on delete restrict,
  doctor_id         uuid references public.doctors(id) on delete set null,
  appointment_id    uuid references public.appointments(id) on delete set null,
  medical_record_id uuid references public.medical_records(id) on delete set null,

  document_type     public.document_type not null default 'other',
  title             text not null,
  description       text,

  -- Ruta dentro del bucket de Storage (no URL pública: el bucket es privado).
  storage_path      text not null,
  mime_type         text,
  size_bytes        bigint,

  -- Permite al paciente ocultar un documento sin borrarlo.
  is_visible_to_patient boolean not null default true,

  created_at        timestamptz not null default now(),

  constraint documents_size_sane check (size_bytes is null or size_bytes >= 0)
);

comment on table public.documents is
  'Documentos clínicos en Storage privado. storage_path, nunca URL pública.';

create index documents_patient_idx on public.documents (patient_id, created_at desc);
create index documents_doctor_idx  on public.documents (doctor_id);

create trigger documents_audit
  after insert or update or delete on public.documents
  for each row execute function public.audit_row();

-- -----------------------------------------------------------------------------
-- RLS — el bloque más restrictivo del esquema
-- -----------------------------------------------------------------------------
alter table public.medical_records    enable row level security;
alter table public.prescriptions      enable row level security;
alter table public.prescription_items enable row level security;
alter table public.documents          enable row level security;

-- medical_records: el paciente lee lo suyo; el médico tratante lee y escribe.
-- Deliberadamente NO hay policy de administrador: un admin de plataforma no
-- tiene por qué leer diagnósticos. Para soporte se usa la bitácora, no el dato.
create policy "medical_records_select_patient"
  on public.medical_records for select
  to authenticated
  using (patient_id = public.current_patient_id());

create policy "medical_records_select_doctor"
  on public.medical_records for select
  to authenticated
  using (doctor_id = public.current_doctor_id());

create policy "medical_records_write_doctor"
  on public.medical_records for insert
  to authenticated
  with check (
    doctor_id = public.current_doctor_id()
    and public.doctor_treats_patient(patient_id)
  );

create policy "medical_records_update_doctor"
  on public.medical_records for update
  to authenticated
  using (doctor_id = public.current_doctor_id())
  with check (doctor_id = public.current_doctor_id());

-- prescriptions: mismas reglas.
create policy "prescriptions_select_patient"
  on public.prescriptions for select
  to authenticated
  using (patient_id = public.current_patient_id());

create policy "prescriptions_select_doctor"
  on public.prescriptions for select
  to authenticated
  using (doctor_id = public.current_doctor_id());

create policy "prescriptions_write_doctor"
  on public.prescriptions for insert
  to authenticated
  with check (
    doctor_id = public.current_doctor_id()
    and public.doctor_treats_patient(patient_id)
  );

create policy "prescriptions_update_doctor"
  on public.prescriptions for update
  to authenticated
  using (doctor_id = public.current_doctor_id())
  with check (doctor_id = public.current_doctor_id());

-- prescription_items hereda el permiso de su receta.
create policy "prescription_items_select"
  on public.prescription_items for select
  to authenticated
  using (exists (
    select 1 from public.prescriptions p
    where p.id = prescription_id
      and (p.patient_id = public.current_patient_id()
           or p.doctor_id = public.current_doctor_id())
  ));

create policy "prescription_items_write_doctor"
  on public.prescription_items for all
  to authenticated
  using (exists (
    select 1 from public.prescriptions p
    where p.id = prescription_id and p.doctor_id = public.current_doctor_id()
  ))
  with check (exists (
    select 1 from public.prescriptions p
    where p.id = prescription_id and p.doctor_id = public.current_doctor_id()
  ));

-- documents: el paciente ve los suyos marcados como visibles; el médico
-- tratante ve los del paciente que atiende.
create policy "documents_select_patient"
  on public.documents for select
  to authenticated
  using (patient_id = public.current_patient_id() and is_visible_to_patient);

create policy "documents_select_doctor"
  on public.documents for select
  to authenticated
  using (public.doctor_treats_patient(patient_id));

create policy "documents_insert_patient"
  on public.documents for insert
  to authenticated
  with check (
    patient_id = public.current_patient_id()
    and uploaded_by = auth.uid()
  );

create policy "documents_insert_doctor"
  on public.documents for insert
  to authenticated
  with check (
    doctor_id = public.current_doctor_id()
    and uploaded_by = auth.uid()
    and public.doctor_treats_patient(patient_id)
  );

create policy "documents_delete_owner"
  on public.documents for delete
  to authenticated
  using (uploaded_by = auth.uid());
