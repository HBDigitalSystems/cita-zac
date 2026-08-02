-- =============================================================================
-- DoctorCita · Fase 8 · Notificaciones automáticas
-- =============================================================================
-- La tabla `notifications` existe desde la Fase 1 pero nadie escribía en ella.
-- Aquí se conectan los hechos del negocio con el centro de notificaciones.
--
-- Todo pasa por triggers y no por el cliente, por dos razones:
--
--   1. `notifications` no tiene política de INSERT, a propósito. Si el aviso lo
--      creara el navegador, cualquiera podría fabricar notificaciones ajenas —
--      "su médico canceló la cita", firmado por un desconocido. Los triggers
--      son SECURITY DEFINER y corren como propietario, que es el único camino
--      de escritura que existe.
--
--   2. Una cita cancelada desde el panel de administración, desde un script o
--      desde una futura app móvil genera el mismo aviso sin duplicar código.
--
-- Alcance: solo canal `in_app`. Correo, SMS y WhatsApp están modelados en el
-- enum desde la Fase 1, pero mandarlos de verdad exige un proveedor externo y
-- una cola de reintentos; queda para cuando haya proveedor contratado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper de escritura
-- -----------------------------------------------------------------------------
create or replace function public.notify(
  p_user_id uuid,
  p_type    public.notification_type,
  p_title   text,
  p_body    text default null,
  p_action_url text default null,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Un destinatario nulo no es un error: una cita puede quedar sin médico
  -- asignado, o el usuario puede haberse dado de baja. Simplemente no hay a
  -- quién avisar.
  if p_user_id is null then
    return;
  end if;

  insert into public.notifications (user_id, notification_type, channel, title, body, action_url, payload)
  values (p_user_id, p_type, 'in_app', p_title, p_body, p_action_url, coalesce(p_payload, '{}'::jsonb));
end;
$$;

revoke execute on function public.notify(uuid, public.notification_type, text, text, text, jsonb)
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Fecha legible en la zona horaria de la plataforma
-- -----------------------------------------------------------------------------
-- Formatear en SQL es tentador y ya nos costó tres errores de zona horaria en
-- la agenda. Aquí se hace igual que en `get_available_slots`: leyendo el ajuste
-- `platform.timezone` en vez de confiar en el `TimeZone` de la sesión, que en
-- PostgREST es UTC y convertiría las 09:00 en «03:00».
create or replace function public.format_appointment_when(p_starts_at timestamptz)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_timezone text;
  v_local    timestamp;
  v_dias     text[] := array['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  v_meses    text[] := array['enero','febrero','marzo','abril','mayo','junio',
                             'julio','agosto','septiembre','octubre','noviembre','diciembre'];
begin
  select coalesce((value #>> '{}'), 'America/Mexico_City') into v_timezone
    from public.settings where key = 'platform.timezone';
  v_timezone := coalesce(v_timezone, 'America/Mexico_City');

  v_local := p_starts_at at time zone v_timezone;

  -- `to_char` daría los nombres en inglés salvo que el servidor tenga el locale
  -- español instalado, cosa que no se puede dar por hecha en Supabase. Los
  -- arreglos de arriba evitan depender de eso.
  return v_dias[extract(dow from v_local)::int + 1]
      || ' ' || extract(day from v_local)::int
      || ' de ' || v_meses[extract(month from v_local)::int]
      || ' a las ' || to_char(v_local, 'HH24:MI');
end;
$$;

revoke execute on function public.format_appointment_when(timestamptz) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Identidades de las dos partes de una cita
-- -----------------------------------------------------------------------------
create or replace function public.appointment_parties(p_appointment_id uuid)
returns table (patient_user_id uuid, doctor_user_id uuid, doctor_label text, patient_label text, doctor_slug text)
language sql
stable
security definer
set search_path = public
as $$
  select pu.id,
         du.id,
         coalesce(dp.display_name, du.full_name, 'tu médico'),
         coalesce(pu.full_name, 'un paciente'),
         d.slug
    from public.appointments a
    join public.patients p       on p.id = a.patient_id
    join public.users    pu      on pu.id = p.user_id
    join public.doctors  d       on d.id = a.doctor_id
    join public.users    du      on du.id = d.user_id
    left join public.doctor_profiles dp on dp.doctor_id = d.id
   where a.id = p_appointment_id;
$$;

revoke execute on function public.appointment_parties(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Citas
-- -----------------------------------------------------------------------------
create or replace function public.notify_on_appointment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  v_when text;
  v_cancelled_by_patient boolean;
begin
  select * into v from public.appointment_parties(new.id);
  v_when := public.format_appointment_when(new.starts_at);

  if tg_op = 'INSERT' then
    -- El médico se entera de que tiene una cita nueva.
    perform public.notify(
      v.doctor_user_id, 'appointment_created',
      'Nueva cita agendada',
      v.patient_label || ' reservó para el ' || v_when || '.',
      '/panel/medico',
      jsonb_build_object('appointment_id', new.id, 'reference', new.reference)
    );
    return new;
  end if;

  -- A partir de aquí solo interesan los cambios de estado.
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'confirmed' then
    perform public.notify(
      v.patient_user_id, 'appointment_confirmed',
      'Tu cita fue confirmada',
      v.doctor_label || ' confirmó tu cita del ' || v_when || '.',
      '/panel/paciente',
      jsonb_build_object('appointment_id', new.id, 'reference', new.reference)
    );

  elsif new.status in ('cancelled_by_patient', 'cancelled_by_doctor') then
    -- Se avisa a quien NO canceló: el que pulsó el botón ya lo sabe. Quién fue
    -- lo dice el propio estado, que es dato obligatorio; la columna
    -- `cancelled_by` admite nulos y no serviría para decidir.
    v_cancelled_by_patient := (new.status = 'cancelled_by_patient');

    if v_cancelled_by_patient then
      perform public.notify(
        v.doctor_user_id, 'appointment_cancelled',
        'Cita cancelada',
        v.patient_label || ' canceló la cita del ' || v_when || '.',
        '/panel/medico',
        jsonb_build_object('appointment_id', new.id, 'reference', new.reference)
      );
    else
      perform public.notify(
        v.patient_user_id, 'appointment_cancelled',
        'Tu cita fue cancelada',
        v.doctor_label || ' canceló la cita del ' || v_when || '.'
          || coalesce(' Motivo: ' || nullif(trim(new.cancellation_reason), ''), ''),
        '/medicos/' || v.doctor_slug,
        jsonb_build_object('appointment_id', new.id, 'reference', new.reference)
      );
    end if;

  elsif new.status = 'completed' then
    -- Es el único momento en que se puede reseñar, así que es cuando se pide.
    perform public.notify(
      v.patient_user_id, 'appointment_reminder',
      '¿Cómo te fue en tu consulta?',
      'Cuéntale a otros pacientes cómo fue tu cita con ' || v.doctor_label || '.',
      '/panel/paciente',
      jsonb_build_object('appointment_id', new.id, 'invita_a_resenar', true)
    );
  end if;

  return new;
end;
$$;

create trigger appointments_notify
  after insert or update of status on public.appointments
  for each row execute function public.notify_on_appointment();

-- -----------------------------------------------------------------------------
-- Mensajes
-- -----------------------------------------------------------------------------
create or replace function public.notify_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patient_user uuid;
  v_doctor_user  uuid;
  v_destino      uuid;
  v_remitente    text;
begin
  select pu.id, du.id
    into v_patient_user, v_doctor_user
    from public.conversations c
    join public.patients p  on p.id = c.patient_id
    join public.users    pu on pu.id = p.user_id
    join public.doctors  d  on d.id = c.doctor_id
    join public.users    du on du.id = d.user_id
   where c.id = new.conversation_id;

  v_destino := case when new.sender_id = v_patient_user then v_doctor_user else v_patient_user end;

  select coalesce(full_name, 'Alguien') into v_remitente
    from public.users where id = new.sender_id;

  -- El cuerpo del mensaje no se copia al aviso. Una notificación es metadato,
  -- y el contenido clínico solo debe vivir donde el RLS de `messages` lo
  -- protege; duplicarlo aquí lo sacaría de ese perímetro.
  perform public.notify(
    v_destino, 'message_received',
    'Mensaje nuevo de ' || v_remitente,
    'Tienes un mensaje sin leer.',
    '/panel/mensajes?c=' || new.conversation_id,
    jsonb_build_object('conversation_id', new.conversation_id)
  );

  return new;
end;
$$;

create trigger messages_notify
  after insert on public.messages
  for each row execute function public.notify_on_message();

-- -----------------------------------------------------------------------------
-- Reseñas
-- -----------------------------------------------------------------------------
create or replace function public.notify_on_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doctor_user  uuid;
  v_patient_user uuid;
  v_slug         text;
begin
  select du.id, d.slug into v_doctor_user, v_slug
    from public.doctors d join public.users du on du.id = d.user_id
   where d.id = new.doctor_id;

  select pu.id into v_patient_user
    from public.patients p join public.users pu on pu.id = p.user_id
   where p.id = new.patient_id;

  if tg_op = 'INSERT' then
    perform public.notify(
      v_doctor_user, 'review_received',
      'Recibiste una reseña de ' || new.rating || ' estrella' || case when new.rating = 1 then '' else 's' end,
      coalesce(new.author_display_name, 'Un paciente') || ' opinó sobre tu consulta.',
      '/panel/medico',
      jsonb_build_object('review_id', new.id)
    );

  elsif new.doctor_reply is distinct from old.doctor_reply
        and nullif(trim(coalesce(new.doctor_reply, '')), '') is not null then
    perform public.notify(
      v_patient_user, 'review_replied',
      'Tu médico respondió a tu reseña',
      'Hay una respuesta a la opinión que dejaste.',
      '/medicos/' || v_slug,
      jsonb_build_object('review_id', new.id)
    );
  end if;

  return new;
end;
$$;

create trigger reviews_notify
  after insert or update of doctor_reply on public.reviews
  for each row execute function public.notify_on_review();

-- -----------------------------------------------------------------------------
-- Verificación del médico
-- -----------------------------------------------------------------------------
create or replace function public.notify_on_doctor_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'verified' then
    perform public.notify(
      new.user_id, 'doctor_verified',
      'Tu perfil fue verificado',
      'Tu cédula quedó validada y tu perfil ya aparece en el buscador.',
      '/panel/medico',
      jsonb_build_object('doctor_id', new.id)
    );

  elsif new.status = 'rejected' then
    perform public.notify(
      new.user_id, 'doctor_rejected',
      'Tu perfil necesita correcciones',
      coalesce(nullif(trim(new.rejection_reason), ''), 'Revisa los datos de tu cédula profesional.'),
      '/panel/medico',
      jsonb_build_object('doctor_id', new.id)
    );

  elsif new.status = 'suspended' then
    perform public.notify(
      new.user_id, 'system',
      'Tu perfil fue suspendido',
      coalesce(nullif(trim(new.rejection_reason), ''), 'Tu perfil dejó de mostrarse en el buscador.'),
      '/panel/medico',
      jsonb_build_object('doctor_id', new.id)
    );
  end if;

  return new;
end;
$$;

create trigger doctors_notify_status
  after update of status on public.doctors
  for each row execute function public.notify_on_doctor_status();

-- -----------------------------------------------------------------------------
-- Marcar todas como leídas
-- -----------------------------------------------------------------------------
-- Un UPDATE masivo desde el cliente tendría que enumerar los ids; esto lo
-- resuelve en una sola llamada y sin exponer más superficie: solo toca las
-- filas del propio usuario.
create or replace function public.mark_all_notifications_read()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.notifications
     set read_at = now()
   where user_id = auth.uid()
     and read_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
