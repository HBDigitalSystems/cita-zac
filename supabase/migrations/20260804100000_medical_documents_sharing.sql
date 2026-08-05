-- =============================================================================
-- DoctorCita · Compartir documentos clínicos sin service_role
-- =============================================================================
-- La policy de la Fase 1 solo deja entrar al dueño de la carpeta, y su comentario
-- remite a URLs firmadas generadas en el servidor con `service_role` tras
-- comprobar el permiso contra `public.documents`.
--
-- Ese diseño no se sostiene:
--
--   · Rompe el reparto en las dos direcciones. Si el médico sube un estudio a
--     su carpeta, el paciente no puede abrirlo; si lo sube el paciente, no
--     puede abrirlo el médico. Justo lo contrario de lo que hace falta.
--
--   · Exige `service_role` en la aplicación. Esa clave salta el RLS ENTERO —no
--     solo el de documentos— así que un fallo en ese trozo de servidor
--     expondría diagnósticos, mensajes y expedientes de toda la plataforma.
--
-- La autorización ya existe y es la fila de `public.documents`: dice de qué
-- paciente es el archivo, quién lo subió y si el paciente puede verlo. Basta
-- con que Storage la consulte. Así el permiso se decide una sola vez y en un
-- solo sitio, y no hace falta ninguna clave privilegiada.
-- =============================================================================

create policy "medical_documents_read_via_documents"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'medical-documents'
    and exists (
      select 1
        from public.documents d
       where d.storage_path = storage.objects.name
         and (
           -- El paciente, si no lo ha ocultado.
           (d.patient_id = public.current_patient_id() and d.is_visible_to_patient)
           -- O un médico que lo atiende de verdad: `doctor_treats_patient`
           -- exige una cita entre ambos, no basta con tener rol de médico.
           or public.doctor_treats_patient(d.patient_id)
         )
    )
  );

comment on policy "medical_documents_read_via_documents" on storage.objects is
  'Quien puede leer un estudio lo decide su fila en public.documents, no la carpeta.';

-- La escritura sigue restringida a la carpeta propia (policy de la Fase 1): se
-- sube a `<mi_id>/…` y la fila de `documents` es la que luego lo comparte. Con
-- eso nadie puede colocar archivos en la carpeta de otra persona.

-- -----------------------------------------------------------------------------
-- Borrar el archivo al borrar su ficha
-- -----------------------------------------------------------------------------
-- Sin esto, borrar la fila de `documents` deja el archivo huérfano en el bucket:
-- invisible en la aplicación —ya no hay fila que lo autorice— pero ocupando
-- espacio y, sobre todo, conservado indefinidamente. Un estudio médico que el
-- paciente creyó haber borrado no debe seguir almacenado.
create or replace function public.delete_document_object()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from storage.objects
   where bucket_id = 'medical-documents'
     and name = old.storage_path;
  return old;
end;
$$;

create trigger documents_delete_object
  after delete on public.documents
  for each row execute function public.delete_document_object();
