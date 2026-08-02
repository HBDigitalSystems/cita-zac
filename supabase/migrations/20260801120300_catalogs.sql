-- =============================================================================
-- DoctorCita · Fase 1 · 04 — Catálogos
-- =============================================================================
-- Municipios, especialidades, subespecialidades, aseguradoras, idiomas y
-- establecimientos (clínicas / hospitales / laboratorios).
--
-- NOTA DE DISEÑO — desviación deliberada del PRD:
-- El PRD pide tres tablas separadas (clinics, hospitals, laboratories). Las tres
-- comparten exactamente las mismas columnas y se consultan siempre igual, así
-- que se unifican en `facilities` con un discriminador `facility_type`. Ventajas:
-- una sola FK desde consultorios y afiliaciones médicas, un solo CRUD en el
-- panel admin y un solo índice de búsqueda. Si en el futuro divergen, se
-- extraen con tablas satélite sin romper las FKs existentes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- municipalities
-- -----------------------------------------------------------------------------
create table public.municipalities (
  id          smallint generated always as identity primary key,
  name        text not null,
  slug        text not null unique,
  -- Clave INEGI del municipio, útil para cruzar con datos oficiales.
  inegi_code  text unique,
  state       text not null default 'Zacatecas',
  latitude    numeric(9, 6),
  longitude   numeric(9, 6),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),

  unique (state, name)
);

comment on table public.municipalities is
  'Municipios de operación. Se siembran los 20 del PRD; la tabla admite los 58 de Zacatecas.';

create index municipalities_active_idx on public.municipalities (is_active) where is_active;

insert into public.municipalities (name, slug) values
  ('Zacatecas',                 'zacatecas'),
  ('Guadalupe',                 'guadalupe'),
  ('Fresnillo',                 'fresnillo'),
  ('Jerez',                     'jerez'),
  ('Río Grande',                'rio-grande'),
  ('Sombrerete',                'sombrerete'),
  ('Loreto',                    'loreto'),
  ('Calera',                    'calera'),
  ('Ojocaliente',               'ojocaliente'),
  ('Nochistlán',                'nochistlan'),
  ('Jalpa',                     'jalpa'),
  ('Pinos',                     'pinos'),
  ('Villanueva',                'villanueva'),
  ('Tlaltenango',               'tlaltenango'),
  ('Miguel Auza',               'miguel-auza'),
  ('Juan Aldama',               'juan-aldama'),
  ('Concepción del Oro',        'concepcion-del-oro'),
  ('Valparaíso',                'valparaiso'),
  ('Mazapil',                   'mazapil'),
  ('Teúl de González Ortega',   'teul-de-gonzalez-ortega');

-- -----------------------------------------------------------------------------
-- specialties
-- -----------------------------------------------------------------------------
create table public.specialties (
  id            smallint generated always as identity primary key,
  name          text not null unique,
  slug          text not null unique,
  description   text,
  -- Emoji o nombre de icono lucide para las tarjetas del buscador.
  icon          text,
  is_featured   boolean not null default false,
  display_order smallint not null default 100,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

comment on table public.specialties is 'Catálogo de especialidades médicas (PRD: 45).';

create index specialties_featured_idx on public.specialties (is_featured, display_order)
  where is_active;

insert into public.specialties (name, slug, icon, is_featured, display_order) values
  ('Medicina General',                'medicina-general',                 '🩺', true,  1),
  ('Pediatría',                       'pediatria',                        '👶', true,  2),
  ('Ginecología',                     'ginecologia',                      '🌸', true,  3),
  ('Cardiología',                     'cardiologia',                      '❤️', true,  4),
  ('Dermatología',                    'dermatologia',                     '✨', true,  5),
  ('Odontología',                     'odontologia',                      '🦷', true,  6),
  ('Psicología',                      'psicologia',                       '🧠', true,  7),
  ('Nutrición',                       'nutricion',                        '🥗', true,  8),
  ('Traumatología',                   'traumatologia',                    null, false, 100),
  ('Neurología',                      'neurologia',                       null, false, 100),
  ('Oftalmología',                    'oftalmologia',                     null, false, 100),
  ('Psiquiatría',                     'psiquiatria',                      null, false, 100),
  ('Urología',                        'urologia',                         null, false, 100),
  ('Cirugía General',                 'cirugia-general',                  null, false, 100),
  ('Medicina Interna',                'medicina-interna',                 null, false, 100),
  ('Endocrinología',                  'endocrinologia',                   null, false, 100),
  ('Neumología',                      'neumologia',                       null, false, 100),
  ('Reumatología',                    'reumatologia',                     null, false, 100),
  ('Oncología',                       'oncologia',                        null, false, 100),
  ('Ortopedia',                       'ortopedia',                        null, false, 100),
  ('Otorrinolaringología',            'otorrinolaringologia',             null, false, 100),
  ('Gastroenterología',               'gastroenterologia',                null, false, 100),
  ('Nefrología',                      'nefrologia',                       null, false, 100),
  ('Infectología',                    'infectologia',                     null, false, 100),
  ('Medicina Familiar',               'medicina-familiar',                null, false, 100),
  ('Medicina del Deporte',            'medicina-del-deporte',             null, false, 100),
  ('Anestesiología',                  'anestesiologia',                   null, false, 100),
  ('Medicina Estética',               'medicina-estetica',                null, false, 100),
  ('Radiología',                      'radiologia',                       null, false, 100),
  ('Medicina Física y Rehabilitación','medicina-fisica-y-rehabilitacion', null, false, 100),
  ('Alergología',                     'alergologia',                      null, false, 100),
  ('Angiología',                      'angiologia',                       null, false, 100),
  ('Cirugía Plástica',                'cirugia-plastica',                 null, false, 100),
  ('Cirugía Cardiovascular',          'cirugia-cardiovascular',           null, false, 100),
  ('Coloproctología',                 'coloproctologia',                  null, false, 100),
  ('Geriatría',                       'geriatria',                        null, false, 100),
  ('Hematología',                     'hematologia',                      null, false, 100),
  ('Hepatología',                     'hepatologia',                      null, false, 100),
  ('Inmunología',                     'inmunologia',                      null, false, 100),
  ('Neurocirugía',                    'neurocirugia',                     null, false, 100),
  ('Audiología',                      'audiologia',                       null, false, 100),
  ('Foniatría',                       'foniatria',                        null, false, 100),
  ('Genética Médica',                 'genetica-medica',                  null, false, 100),
  ('Patología',                       'patologia',                        null, false, 100),
  ('Medicina del Trabajo',            'medicina-del-trabajo',             null, false, 100);

-- -----------------------------------------------------------------------------
-- subspecialties
-- -----------------------------------------------------------------------------
create table public.subspecialties (
  id           smallint generated always as identity primary key,
  specialty_id smallint not null references public.specialties(id) on delete cascade,
  name         text not null,
  slug         text not null unique,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),

  unique (specialty_id, name)
);

comment on table public.subspecialties is
  'Subespecialidades colgando de una especialidad (PRD: 80). Se siembra un subconjunto representativo; el resto se completa en Fase 11.';

create index subspecialties_specialty_idx on public.subspecialties (specialty_id);

insert into public.subspecialties (specialty_id, name, slug)
select s.id, v.name, v.slug
from (values
  ('cardiologia',     'Cardiología Intervencionista',   'cardiologia-intervencionista'),
  ('cardiologia',     'Electrofisiología',              'electrofisiologia'),
  ('cardiologia',     'Cardiología Pediátrica',         'cardiologia-pediatrica'),
  ('pediatria',       'Neonatología',                   'neonatologia'),
  ('pediatria',       'Neurología Pediátrica',          'neurologia-pediatrica'),
  ('pediatria',       'Gastroenterología Pediátrica',   'gastroenterologia-pediatrica'),
  ('ginecologia',     'Biología de la Reproducción',    'biologia-de-la-reproduccion'),
  ('ginecologia',     'Medicina Materno Fetal',         'medicina-materno-fetal'),
  ('ginecologia',     'Ginecología Oncológica',         'ginecologia-oncologica'),
  ('dermatologia',    'Dermatología Pediátrica',        'dermatologia-pediatrica'),
  ('dermatologia',    'Dermatología Oncológica',        'dermatologia-oncologica'),
  ('odontologia',     'Ortodoncia',                     'ortodoncia'),
  ('odontologia',     'Endodoncia',                     'endodoncia'),
  ('odontologia',     'Periodoncia',                    'periodoncia'),
  ('odontologia',     'Odontopediatría',                'odontopediatria'),
  ('odontologia',     'Implantología',                  'implantologia'),
  ('psicologia',      'Psicología Clínica',             'psicologia-clinica'),
  ('psicologia',      'Psicología Infantil',            'psicologia-infantil'),
  ('psicologia',      'Terapia de Pareja',              'terapia-de-pareja'),
  ('psiquiatria',     'Psiquiatría Infantil',           'psiquiatria-infantil'),
  ('psiquiatria',     'Adicciones',                     'adicciones'),
  ('traumatologia',   'Cirugía de Rodilla',             'cirugia-de-rodilla'),
  ('traumatologia',   'Cirugía de Columna',             'cirugia-de-columna'),
  ('traumatologia',   'Cirugía de Hombro',              'cirugia-de-hombro'),
  ('traumatologia',   'Traumatología Deportiva',        'traumatologia-deportiva'),
  ('oftalmologia',    'Retina',                         'retina'),
  ('oftalmologia',    'Córnea',                         'cornea'),
  ('oftalmologia',    'Glaucoma',                       'glaucoma'),
  ('oftalmologia',    'Oftalmología Pediátrica',        'oftalmologia-pediatrica'),
  ('neurologia',      'Epilepsia',                      'epilepsia'),
  ('neurologia',      'Trastornos del Movimiento',      'trastornos-del-movimiento'),
  ('neurologia',      'Neurofisiología',                'neurofisiologia'),
  ('oncologia',       'Oncología Médica',               'oncologia-medica'),
  ('oncologia',       'Radio-oncología',                'radio-oncologia'),
  ('oncologia',       'Oncología Quirúrgica',           'oncologia-quirurgica'),
  ('nutricion',       'Nutrición Clínica',              'nutricion-clinica'),
  ('nutricion',       'Nutrición Deportiva',            'nutricion-deportiva'),
  ('nutricion',       'Nutrición Pediátrica',           'nutricion-pediatrica'),
  ('medicina-interna','Medicina Crítica',               'medicina-critica'),
  ('urologia',        'Urología Oncológica',            'urologia-oncologica'),
  ('urologia',        'Andrología',                     'andrologia'),
  ('endocrinologia',  'Diabetes',                       'diabetes'),
  ('endocrinologia',  'Tiroides',                       'tiroides'),
  ('gastroenterologia','Endoscopia Digestiva',          'endoscopia-digestiva'),
  ('gastroenterologia','Hepatología Clínica',           'hepatologia-clinica'),
  ('cirugia-general', 'Cirugía Laparoscópica',          'cirugia-laparoscopica'),
  ('cirugia-general', 'Cirugía Bariátrica',             'cirugia-bariatrica'),
  ('neumologia',      'Medicina del Sueño',             'medicina-del-sueno'),
  ('medicina-estetica','Medicina Antienvejecimiento',   'medicina-antienvejecimiento'),
  ('radiologia',      'Radiología Intervencionista',    'radiologia-intervencionista')
) as v(specialty_slug, name, slug)
join public.specialties s on s.slug = v.specialty_slug;

-- -----------------------------------------------------------------------------
-- insurance_companies
-- -----------------------------------------------------------------------------
create table public.insurance_companies (
  id         smallint generated always as identity primary key,
  name       text not null unique,
  slug       text not null unique,
  logo_url   text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.insurance_companies is 'Aseguradoras aceptadas por los médicos.';

insert into public.insurance_companies (name, slug) values
  ('GNP Seguros',        'gnp-seguros'),
  ('AXA',                'axa'),
  ('MetLife',            'metlife'),
  ('Seguros Monterrey',  'seguros-monterrey'),
  ('Mapfre',             'mapfre'),
  ('Allianz',            'allianz'),
  ('Zurich',             'zurich'),
  ('Bupa',               'bupa'),
  ('Atlas Seguros',      'atlas-seguros'),
  ('Qualitas',           'qualitas');

-- -----------------------------------------------------------------------------
-- languages
-- -----------------------------------------------------------------------------
create table public.languages (
  id         smallint generated always as identity primary key,
  code       text not null unique,
  name       text not null,
  is_active  boolean not null default true
);

comment on table public.languages is 'Idiomas en que un médico puede atender.';

insert into public.languages (code, name) values
  ('es',  'Español'),
  ('en',  'Inglés'),
  ('fr',  'Francés'),
  ('de',  'Alemán'),
  ('it',  'Italiano'),
  ('pt',  'Portugués'),
  ('zh',  'Chino'),
  ('lsm', 'Lengua de Señas Mexicana'),
  ('nah', 'Náhuatl'),
  ('hch', 'Huichol');

-- -----------------------------------------------------------------------------
-- facilities — clínicas, hospitales y laboratorios
-- -----------------------------------------------------------------------------
create type public.facility_type as enum ('clinic', 'hospital', 'laboratory');

create table public.facilities (
  id              uuid primary key default gen_random_uuid(),
  facility_type   public.facility_type not null,
  name            text not null,
  slug            text not null unique,
  municipality_id smallint not null references public.municipalities(id) on delete restrict,
  address         text,
  postal_code     text,
  phone           text,
  email           extensions.citext,
  website         text,
  latitude        numeric(9, 6),
  longitude       numeric(9, 6),
  logo_url        text,
  photos          text[] not null default '{}',
  services        text[] not null default '{}',
  is_verified     boolean not null default false,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint facilities_postal_code_format check (
    postal_code is null or postal_code ~ '^[0-9]{5}$'
  )
);

comment on table public.facilities is
  'Establecimientos de salud. Unifica clinics/hospitals/laboratories del PRD mediante facility_type.';

create index facilities_type_idx         on public.facilities (facility_type) where is_active;
create index facilities_municipality_idx on public.facilities (municipality_id) where is_active;
create index facilities_name_trgm_idx    on public.facilities
  using gin (public.unaccent_immutable(name) extensions.gin_trgm_ops);

create trigger facilities_set_updated_at
  before update on public.facilities
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS — los catálogos son de lectura pública (los necesita el buscador anónimo)
-- -----------------------------------------------------------------------------
alter table public.municipalities      enable row level security;
alter table public.specialties         enable row level security;
alter table public.subspecialties      enable row level security;
alter table public.insurance_companies enable row level security;
alter table public.languages           enable row level security;
alter table public.facilities          enable row level security;

create policy "municipalities_select_all" on public.municipalities
  for select to anon, authenticated using (is_active or public.is_admin());
create policy "municipalities_write_admin" on public.municipalities
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "specialties_select_all" on public.specialties
  for select to anon, authenticated using (is_active or public.is_admin());
create policy "specialties_write_admin" on public.specialties
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "subspecialties_select_all" on public.subspecialties
  for select to anon, authenticated using (is_active or public.is_admin());
create policy "subspecialties_write_admin" on public.subspecialties
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "insurance_companies_select_all" on public.insurance_companies
  for select to anon, authenticated using (is_active or public.is_admin());
create policy "insurance_companies_write_admin" on public.insurance_companies
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "languages_select_all" on public.languages
  for select to anon, authenticated using (true);
create policy "languages_write_admin" on public.languages
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "facilities_select_all" on public.facilities
  for select to anon, authenticated using (is_active or public.is_admin());
create policy "facilities_write_admin" on public.facilities
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
