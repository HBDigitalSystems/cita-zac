-- =============================================================================
-- DoctorCita · Los 58 municipios de Zacatecas
-- =============================================================================
-- La Fase 1 sembró 20, los del PRD. Los 38 restantes no son un adorno: sin
-- ellos, un médico de Juchipila o de Villa de Cos abre el alta de consultorio,
-- no encuentra su municipio en la lista y no puede terminar el registro. La
-- plataforma se anuncia como estatal, así que el catálogo tiene que serlo.
--
-- `inegi_code` se deja NULO a propósito.
--
-- La columna existe desde la Fase 1 para poder cruzar estos municipios con
-- datos oficiales del censo o del sector salud. Rellenarla de memoria sería
-- peor que dejarla vacía: una clave equivocada no falla de forma visible,
-- simplemente empareja el municipio con las cifras de otro. Cuando haga falta,
-- se toma del catálogo publicado por el INEGI y se carga de una vez.
--
-- Los 20 que ya existían NO se tocan. Dos están registrados con su nombre
-- corto —Nochistlán y Tlaltenango— y renombrarlos cambiaría su slug, que ya
-- está guardado en los consultorios sembrados.
-- =============================================================================

insert into public.municipalities (name, slug) values
  ('Apozol',                       'apozol'),
  ('Apulco',                       'apulco'),
  ('Atolinga',                     'atolinga'),
  ('Benito Juárez',                'benito-juarez'),
  ('Cañitas de Felipe Pescador',   'canitas-de-felipe-pescador'),
  ('Cuauhtémoc',                   'cuauhtemoc'),
  ('Chalchihuites',                'chalchihuites'),
  ('Trinidad García de la Cadena', 'trinidad-garcia-de-la-cadena'),
  ('Genaro Codina',                'genaro-codina'),
  ('General Enrique Estrada',      'general-enrique-estrada'),
  ('General Francisco R. Murguía', 'general-francisco-r-murguia'),
  ('El Plateado de Joaquín Amaro', 'el-plateado-de-joaquin-amaro'),
  ('General Pánfilo Natera',       'general-panfilo-natera'),
  ('Huanusco',                     'huanusco'),
  ('Jiménez del Teul',             'jimenez-del-teul'),
  ('Juchipila',                    'juchipila'),
  ('Luis Moya',                    'luis-moya'),
  ('Melchor Ocampo',               'melchor-ocampo'),
  ('Mezquital del Oro',            'mezquital-del-oro'),
  ('Momax',                        'momax'),
  ('Monte Escobedo',               'monte-escobedo'),
  ('Morelos',                      'morelos'),
  ('Moyahua de Estrada',           'moyahua-de-estrada'),
  ('Noria de Ángeles',             'noria-de-angeles'),
  ('Pánuco',                       'panuco'),
  ('Sain Alto',                    'sain-alto'),
  ('El Salvador',                  'el-salvador'),
  ('Susticacán',                   'susticacan'),
  ('Tabasco',                      'tabasco'),
  ('Tepechitlán',                  'tepechitlan'),
  ('Tepetongo',                    'tepetongo'),
  ('Vetagrande',                   'vetagrande'),
  ('Villa de Cos',                 'villa-de-cos'),
  ('Villa García',                 'villa-garcia'),
  ('Villa González Ortega',        'villa-gonzalez-ortega'),
  ('Villa Hidalgo',                'villa-hidalgo'),
  ('Trancoso',                     'trancoso'),
  ('Santa María de la Paz',        'santa-maria-de-la-paz')
on conflict (slug) do nothing;

comment on table public.municipalities is
  'Los 58 municipios de Zacatecas. inegi_code pendiente de cargar del catálogo oficial.';
