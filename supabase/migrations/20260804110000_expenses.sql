-- =============================================================================
-- DoctorCita · Control de gastos
-- =============================================================================
-- Gastos de la clínica, atribuibles a un médico concreto o a la operación
-- general. Sirve para responder dos preguntas: cuánto se gasta en total, y
-- cuánto cuesta cada médico.
--
-- No forma parte del expediente clínico ni de la facturación al paciente: es
-- contabilidad interna. Por eso vive aparte de `invoices` y de `payments`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- expense_categories — conceptos configurables
-- -----------------------------------------------------------------------------
-- Los conceptos son una tabla y no un enum porque el administrador tiene que
-- poder añadirlos desde la aplicación. Un enum obligaría a una migración cada
-- vez que aparezca un gasto nuevo.
create table public.expense_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- Lo rellena el trigger de abajo, por eso admite nulos en la definición.
  slug        text unique,
  description text,

  -- Se desactivan en vez de borrarse: un concepto usado en gastos pasados no
  -- puede desaparecer sin dejar huérfano el histórico.
  is_active   boolean not null default true,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint expense_categories_name_not_blank check (trim(name) <> '')
);

comment on table public.expense_categories is
  'Conceptos de gasto configurables desde el panel de administración.';

create unique index expense_categories_name_key on public.expense_categories (lower(name));

create trigger expense_categories_set_updated_at
  before update on public.expense_categories
  for each row execute function public.set_updated_at();

-- El slug se calcula del nombre. Se hace en un trigger y no en el cliente para
-- que un concepto creado desde un script tenga el mismo slug que uno creado
-- desde el panel.
create or replace function public.set_expense_category_slug()
returns trigger
language plpgsql
as $$
declare
  v_base text := public.slugify(new.name);
  v_slug text := v_base;
  v_n    integer := 1;
begin
  -- "Insumos médicos" y "Insumos medicos" producen el mismo slug, y la columna
  -- es única: se numera en vez de fallar con un error de clave duplicada que
  -- el administrador no sabría interpretar.
  while exists (
    select 1 from public.expense_categories
     where slug = v_slug and id is distinct from new.id
  ) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;

  new.slug := v_slug;
  return new;
end;
$$;

create trigger expense_categories_slug
  before insert or update of name on public.expense_categories
  for each row execute function public.set_expense_category_slug();

-- -----------------------------------------------------------------------------
-- expenses
-- -----------------------------------------------------------------------------
create table public.expenses (
  id            uuid primary key default gen_random_uuid(),

  category_id   uuid references public.expense_categories(id) on delete restrict,

  -- NULL significa gasto de la clínica en general, no un dato que falte. Es la
  -- diferencia entre "la renta del local" y "los materiales de la Dra. Ruiz".
  doctor_id     uuid references public.doctors(id) on delete set null,

  concept       text not null,
  amount_cents  integer not null,
  currency      char(3) not null default 'MXN',

  -- Fecha en que se incurrió, que no tiene por qué ser la de captura: una
  -- factura de marzo puede registrarse en abril y debe contar en marzo.
  incurred_on   date not null default current_date,

  notes         text,
  receipt_path  text,          -- comprobante en Storage, opcional

  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- En centavos, como el resto de importes del esquema: con float o numeric los
  -- redondeos se acumulan al sumar cientos de gastos.
  constraint expenses_amount_non_negative check (amount_cents >= 0),
  constraint expenses_concept_not_blank check (trim(concept) <> '')
);

comment on table public.expenses is
  'Gastos de la clínica. doctor_id nulo = gasto general, no dato faltante.';
comment on column public.expenses.amount_cents is
  'Importe en centavos MXN. Se evita numeric/float para no arrastrar redondeos.';

create index expenses_doctor_idx   on public.expenses (doctor_id, incurred_on desc);
create index expenses_date_idx     on public.expenses (incurred_on desc);
create index expenses_category_idx on public.expenses (category_id);

create trigger expenses_set_updated_at
  before update on public.expenses
  for each row execute function public.set_updated_at();

create trigger expenses_audit
  after insert or update or delete on public.expenses
  for each row execute function public.audit_row();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.expense_categories enable row level security;
alter table public.expenses           enable row level security;

-- Solo administración. Un gasto revela cuánto cuesta cada médico a la clínica,
-- que es información laboral: ni los pacientes ni los demás médicos pintan nada
-- aquí. Deliberadamente NO se le da acceso al médico a los gastos que lleva su
-- nombre; si se decide que deba verlos, es una policy nueva y una decisión de
-- negocio, no un descuido que haya que rellenar.
create policy "expense_categories_all_admin"
  on public.expense_categories for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "expenses_all_admin"
  on public.expenses for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- Resumen para el panel
-- -----------------------------------------------------------------------------
-- Se calcula en la base de datos y no en el navegador: sumar en el cliente
-- obligaría a descargar todos los gastos del periodo solo para pintar cuatro
-- cifras, y a repetir la lógica de agrupación en cada pantalla.
--
-- SECURITY INVOKER a propósito: así el RLS de `expenses` sigue aplicando y la
-- función no se convierte en una puerta trasera para leer lo que la policy
-- niega. Quien no sea administrador recibe ceros.
create or replace function public.expense_summary(
  p_desde date default null,
  p_hasta date default null
)
returns table (
  doctor_id      uuid,
  doctor_nombre  text,
  total_cents    bigint,
  movimientos    bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select e.doctor_id,
         coalesce(dp.display_name, u.full_name, 'Gasto general de la clínica'),
         sum(e.amount_cents)::bigint,
         count(*)::bigint
    from public.expenses e
    left join public.doctors d          on d.id = e.doctor_id
    left join public.users u            on u.id = d.user_id
    left join public.doctor_profiles dp on dp.doctor_id = d.id
   where (p_desde is null or e.incurred_on >= p_desde)
     and (p_hasta is null or e.incurred_on <= p_hasta)
   group by e.doctor_id, dp.display_name, u.full_name
   order by sum(e.amount_cents) desc;
$$;

-- -----------------------------------------------------------------------------
-- Conceptos iniciales
-- -----------------------------------------------------------------------------
-- Un punto de partida razonable para un consultorio en México. El
-- administrador puede añadir, renombrar y desactivar desde el panel.
insert into public.expense_categories (name, description) values
  ('Renta',              'Renta del consultorio o del local'),
  ('Servicios',          'Luz, agua, internet y teléfono'),
  ('Insumos médicos',    'Material de curación, guantes, jeringas'),
  ('Equipo',             'Compra y mantenimiento de equipo médico'),
  ('Nómina',             'Sueldos de recepción, enfermería y limpieza'),
  ('Publicidad',         'Campañas, redes sociales y directorio'),
  ('Software',           'Suscripciones y licencias'),
  ('Impuestos y cuotas', 'Contribuciones, colegios y certificaciones'),
  ('Limpieza',           'Aseo y manejo de residuos biológico-infecciosos'),
  ('Otros',              'Gastos que no encajan en los conceptos anteriores')
on conflict do nothing;
