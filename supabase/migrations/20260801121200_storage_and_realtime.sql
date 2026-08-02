-- =============================================================================
-- DoctorCita · Fase 1 · 13 — Storage y Realtime
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Buckets
-- -----------------------------------------------------------------------------
-- Públicos: lo que se muestra en el perfil público del médico.
-- Privados: todo lo clínico y lo identificable.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 5242880,
   array['image/jpeg', 'image/png', 'image/webp']),

  ('doctor-media', 'doctor-media', true, 10485760,
   array['image/jpeg', 'image/png', 'image/webp', 'video/mp4']),

  ('facility-photos', 'facility-photos', true, 10485760,
   array['image/jpeg', 'image/png', 'image/webp']),

  ('credentials', 'credentials', false, 10485760,
   array['image/jpeg', 'image/png', 'application/pdf']),

  ('medical-documents', 'medical-documents', false, 26214400,
   array['image/jpeg', 'image/png', 'application/pdf', 'application/dicom']),

  ('prescriptions', 'prescriptions', false, 5242880,
   array['application/pdf']),

  ('signatures', 'signatures', false, 2097152,
   array['image/png', 'image/svg+xml']),

  ('message-attachments', 'message-attachments', false, 20971520,
   array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Policies de Storage
-- -----------------------------------------------------------------------------
-- Convención de rutas: <bucket>/<user_id>/<archivo>
-- storage.foldername(name)[1] devuelve el primer segmento de la ruta, que se
-- compara contra auth.uid(). Así cada usuario solo escribe en su carpeta.

-- avatars: lectura pública, escritura en la carpeta propia.
create policy "avatars_public_read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'avatars');

create policy "avatars_write_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- doctor-media y facility-photos: lectura pública, escritura del dueño.
create policy "doctor_media_public_read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'doctor-media');

create policy "doctor_media_write_own"
  on storage.objects for all
  to authenticated
  using (
    bucket_id = 'doctor-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'doctor-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "facility_photos_public_read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'facility-photos');

create policy "facility_photos_write_admin"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'facility-photos' and public.is_admin())
  with check (bucket_id = 'facility-photos' and public.is_admin());

-- credentials: privado. El médico sube; solo él y el admin médico leen.
create policy "credentials_read_own_or_admin"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'credentials'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

create policy "credentials_write_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'credentials'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- signatures: privado y estrictamente personal. Ni siquiera los admin.
create policy "signatures_own_only"
  on storage.objects for all
  to authenticated
  using (
    bucket_id = 'signatures'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'signatures'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- medical-documents y prescriptions: privados. El acceso NO se resuelve aquí
-- con reglas de ruta, porque un médico debe poder leer documentos que están en
-- la carpeta del paciente. Se sirven mediante URLs firmadas generadas en el
-- servidor tras comprobar el permiso contra public.documents. Por eso aquí solo
-- se permite al dueño de la carpeta: todo lo demás pasa por service_role.
create policy "medical_documents_own_folder"
  on storage.objects for all
  to authenticated
  using (
    bucket_id = 'medical-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'medical-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "prescriptions_own_folder"
  on storage.objects for all
  to authenticated
  using (
    bucket_id = 'prescriptions'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'prescriptions'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- message-attachments: carpeta por conversación. La pertenencia se valida en el
-- servidor al generar la URL firmada.
create policy "message_attachments_own_folder"
  on storage.objects for all
  to authenticated
  using (
    bucket_id = 'message-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'message-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- -----------------------------------------------------------------------------
-- Realtime
-- -----------------------------------------------------------------------------
-- Tablas que el frontend escucha en vivo (Fases 6 y 8). Publicar SOLO estas:
-- la publicación respeta el RLS de cada tabla, pero cuantas menos, menos ruido
-- y menos carga en el servidor de Realtime.
alter publication supabase_realtime add table public.appointments;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.conversations;
alter publication supabase_realtime add table public.notifications;

-- REPLICA IDENTITY FULL permite que los eventos de UPDATE/DELETE incluyan el
-- registro anterior. Sin esto, el cliente no puede saber qué cambió ni aplicar
-- correctamente el filtro de RLS en un DELETE.
alter table public.appointments  replica identity full;
alter table public.messages      replica identity full;
alter table public.conversations replica identity full;
alter table public.notifications replica identity full;
