-- =============================================================================
-- DoctorCita · Fase 8 · Integridad del chat
-- =============================================================================
-- Las políticas de la Fase 1 decidían BIEN quién entra a una conversación, pero
-- no qué puede tocar dentro. `messages_update_read_receipt` lleva escrito en su
-- comentario que no se puede editar un mensaje ya enviado, y sin embargo
-- concedía UPDATE sobre todas las columnas a cualquiera de los dos
-- participantes. En un historial clínico eso permite que el paciente reescriba
-- lo que dijo el médico —o al revés— y que la conversación deje de ser prueba
-- de nada.
--
-- El RLS es la herramienta correcta para decidir QUÉ FILAS se ven; para acotar
-- QUÉ COLUMNAS se pueden cambiar hacen falta triggers, que es lo que este
-- archivo añade. Mismo patrón que `protect_review_columns`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Un mensaje enviado es inmutable salvo su acuse de lectura
-- -----------------------------------------------------------------------------
create or replace function public.protect_message_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_internal_write() then
    return new;
  end if;

  if new.body            is distinct from old.body
     or new.attachments  is distinct from old.attachments
     or new.sender_id    is distinct from old.sender_id
     or new.conversation_id is distinct from old.conversation_id
     or new.created_at   is distinct from old.created_at then
    raise exception 'Un mensaje enviado no se puede modificar.' using errcode = '42501';
  end if;

  -- Marcar como leído lo hace quien recibe, no quien escribe. Sin esto, el
  -- remitente podría sellar su propio mensaje como leído y el acuse dejaría de
  -- significar algo.
  if new.read_at is distinct from old.read_at and old.sender_id = auth.uid() then
    raise exception 'El acuse de lectura lo marca quien recibe el mensaje.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger messages_protect_columns
  before update on public.messages
  for each row execute function public.protect_message_columns();

-- -----------------------------------------------------------------------------
-- El resumen del hilo lo mantiene la base de datos, no el cliente
-- -----------------------------------------------------------------------------
-- `last_message_at`, `last_message_preview` y los dos contadores son campos
-- derivados que calcula `sync_conversation_on_message`. Si el navegador pudiera
-- escribirlos, un participante podría poner a cero los no leídos del otro para
-- que no viera que le escribió, o falsear la vista previa del último mensaje.
--
-- Cada quien solo puede reiniciar SU propio contador (lo hace al abrir el
-- hilo) y archivar la conversación.
create or replace function public.protect_conversation_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- `is not distinct from` y no `=`: para un paciente, current_doctor_id()
  -- devuelve NULL, y `algo = NULL` no da FALSO sino NULL. Un `not NULL` sigue
  -- siendo NULL, que el IF interpreta como falso — es decir, el guardia dejaba
  -- pasar exactamente a quien tenía que frenar. Con `is not distinct from` el
  -- resultado siempre es un booleano de verdad.
  v_es_paciente boolean := (old.patient_id is not distinct from public.current_patient_id());
  v_es_medico   boolean := (old.doctor_id  is not distinct from public.current_doctor_id());
begin
  if public.is_internal_write() or public.is_admin() then
    return new;
  end if;

  if new.patient_id is distinct from old.patient_id
     or new.doctor_id is distinct from old.doctor_id
     or new.created_at is distinct from old.created_at
     or new.last_message_at is distinct from old.last_message_at
     or new.last_message_preview is distinct from old.last_message_preview then
    raise exception 'El resumen de la conversación lo mantiene la base de datos.'
      using errcode = '42501';
  end if;

  if new.patient_unread_count is distinct from old.patient_unread_count
     and not v_es_paciente then
    raise exception 'No puedes modificar los no leídos de la otra persona.'
      using errcode = '42501';
  end if;

  if new.doctor_unread_count is distinct from old.doctor_unread_count
     and not v_es_medico then
    raise exception 'No puedes modificar los no leídos de la otra persona.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger conversations_protect_columns
  before update on public.conversations
  for each row execute function public.protect_conversation_columns();

-- -----------------------------------------------------------------------------
-- El sincronizador tiene que poder saltarse el guardia de arriba
-- -----------------------------------------------------------------------------
-- Corre como propietario, pero `auth.uid()` sigue siendo el remitente, así que
-- el trigger anterior lo tomaría por una escritura del cliente y rechazaría el
-- resumen del hilo. Se marca la transacción como escritura interna, igual que
-- hace `sync_doctor_rating`.
create or replace function public.sync_conversation_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender_is_patient boolean;
begin
  select (p.user_id = new.sender_id)
    into v_sender_is_patient
  from public.conversations c
  join public.patients p on p.id = c.patient_id
  where c.id = new.conversation_id;

  perform public.begin_internal_write();

  update public.conversations
     set last_message_at      = new.created_at,
         last_message_preview = left(coalesce(new.body, '📎 Archivo adjunto'), 140),
         patient_unread_count = case when v_sender_is_patient
                                     then patient_unread_count
                                     else patient_unread_count + 1 end,
         doctor_unread_count  = case when v_sender_is_patient
                                     then doctor_unread_count + 1
                                     else doctor_unread_count end
   where id = new.conversation_id;

  perform public.end_internal_write();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Abrir el hilo: marca leídos y pone el contador a cero
-- -----------------------------------------------------------------------------
-- Va en una función y no en dos llamadas del cliente para que ambas cosas
-- ocurran juntas: si se marcaran los mensajes sin reiniciar el contador, la
-- campana seguiría avisando de algo que ya se leyó.
create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_es_paciente boolean;
  v_es_medico   boolean;
begin
  -- El RLS ya decide si se ve la conversación; si no se ve, no hay fila y no
  -- se hace nada. La comprobación de aquí es para saber QUÉ contador tocar.
  select (c.patient_id = public.current_patient_id()),
         (c.doctor_id  = public.current_doctor_id())
    into v_es_paciente, v_es_medico
  from public.conversations c
  where c.id = p_conversation_id;

  if not found then
    return;
  end if;

  update public.messages
     set read_at = now()
   where conversation_id = p_conversation_id
     and read_at is null
     and sender_id <> auth.uid();

  if v_es_paciente then
    update public.conversations set patient_unread_count = 0 where id = p_conversation_id;
  end if;

  if v_es_medico then
    update public.conversations set doctor_unread_count = 0 where id = p_conversation_id;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Abrir (o recuperar) la conversación con un médico
-- -----------------------------------------------------------------------------
-- Hay un único hilo por pareja paciente-médico, con índice único. Sin esta
-- función el cliente tendría que intentar el INSERT, capturar el error de
-- duplicado y volver a consultar; se resuelve en un viaje.
create or replace function public.open_conversation(p_doctor_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_patient_id uuid := public.current_patient_id();
  v_id uuid;
begin
  if v_patient_id is null then
    raise exception 'Necesitas un expediente de paciente para escribir a un médico.'
      using errcode = '42501';
  end if;

  select id into v_id
    from public.conversations
   where patient_id = v_patient_id and doctor_id = p_doctor_id;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.conversations (patient_id, doctor_id)
  values (v_patient_id, p_doctor_id)
  returning id into v_id;

  return v_id;
end;
$$;
