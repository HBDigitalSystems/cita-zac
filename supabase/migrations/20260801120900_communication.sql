-- =============================================================================
-- DoctorCita · Fase 1 · 10 — Mensajería y notificaciones
-- =============================================================================

-- -----------------------------------------------------------------------------
-- conversations — hilo 1:1 entre paciente y médico
-- -----------------------------------------------------------------------------
-- El PRD solo menciona `messages`, pero sin una tabla de hilo no hay forma
-- eficiente de listar "mis conversaciones" ni de llevar el contador de no
-- leídos sin escanear toda la tabla de mensajes.
create table public.conversations (
  id                uuid primary key default gen_random_uuid(),
  patient_id        uuid not null references public.patients(id) on delete cascade,
  doctor_id         uuid not null references public.doctors(id) on delete cascade,

  -- Desnormalizado para pintar la lista de chats sin subconsultas.
  last_message_at   timestamptz,
  last_message_preview text,

  patient_unread_count smallint not null default 0,
  doctor_unread_count  smallint not null default 0,

  is_archived       boolean not null default false,
  created_at        timestamptz not null default now(),

  unique (patient_id, doctor_id)
);

comment on table public.conversations is
  'Hilo de chat paciente↔médico. Un único hilo por pareja (PRD Fase 8).';

create index conversations_patient_idx on public.conversations (patient_id, last_message_at desc);
create index conversations_doctor_idx  on public.conversations (doctor_id, last_message_at desc);

-- -----------------------------------------------------------------------------
-- messages
-- -----------------------------------------------------------------------------
create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id       uuid not null references public.users(id) on delete cascade,

  body            text,

  -- Adjuntos en Storage privado: [{"path":"...","name":"...","mime":"...","size":123}]
  attachments     jsonb not null default '[]'::jsonb,

  read_at         timestamptz,
  created_at      timestamptz not null default now(),

  -- Un mensaje vacío sin adjuntos no tiene sentido.
  constraint messages_has_content check (
    coalesce(trim(body), '') <> '' or jsonb_array_length(attachments) > 0
  )
);

comment on table public.messages is 'Mensajes del chat interno. Realtime habilitado (PRD Fase 8).';

create index messages_conversation_idx on public.messages (conversation_id, created_at desc);
create index messages_unread_idx on public.messages (conversation_id)
  where read_at is null;

-- Mantiene el resumen del hilo y los contadores de no leídos.
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

  return new;
end;
$$;

create trigger messages_sync_conversation
  after insert on public.messages
  for each row execute function public.sync_conversation_on_message();

-- -----------------------------------------------------------------------------
-- notifications
-- -----------------------------------------------------------------------------
create type public.notification_channel as enum ('in_app', 'email', 'push', 'sms', 'whatsapp');

create type public.notification_type as enum (
  'appointment_created', 'appointment_confirmed', 'appointment_reminder',
  'appointment_cancelled', 'appointment_rescheduled',
  'message_received', 'review_received', 'review_replied',
  'prescription_issued', 'document_shared',
  'subscription_expiring', 'subscription_activated', 'payment_failed',
  'doctor_verified', 'doctor_rejected', 'system'
);

create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,

  notification_type public.notification_type not null,
  channel      public.notification_channel not null default 'in_app',

  title        text not null,
  body         text,
  -- Ruta interna a la que lleva la notificación al pulsarla.
  action_url   text,
  -- Contexto libre: {"appointment_id":"...", "doctor_id":"..."}
  payload      jsonb not null default '{}'::jsonb,

  read_at      timestamptz,
  -- Para canales externos (correo/SMS/WhatsApp): cuándo salió de verdad.
  sent_at      timestamptz,
  failed_at    timestamptz,
  failure_reason text,

  created_at   timestamptz not null default now()
);

comment on table public.notifications is
  'Centro de notificaciones multicanal. SMS y WhatsApp quedan modelados pero inactivos hasta Fase 8.';

create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id)
  where read_at is null;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.conversations enable row level security;
alter table public.messages      enable row level security;
alter table public.notifications enable row level security;

-- Participar en la conversación es la única llave. Sin policy de admin: el
-- contenido de un chat clínico no es asunto de la plataforma.
create policy "conversations_select_participant"
  on public.conversations for select
  to authenticated
  using (
    patient_id = public.current_patient_id()
    or doctor_id = public.current_doctor_id()
  );

create policy "conversations_insert_participant"
  on public.conversations for insert
  to authenticated
  with check (
    patient_id = public.current_patient_id()
    or doctor_id = public.current_doctor_id()
  );

create policy "conversations_update_participant"
  on public.conversations for update
  to authenticated
  using (
    patient_id = public.current_patient_id()
    or doctor_id = public.current_doctor_id()
  )
  with check (
    patient_id = public.current_patient_id()
    or doctor_id = public.current_doctor_id()
  );

create policy "messages_select_participant"
  on public.messages for select
  to authenticated
  using (exists (
    select 1 from public.conversations c
    where c.id = conversation_id
      and (c.patient_id = public.current_patient_id()
           or c.doctor_id = public.current_doctor_id())
  ));

-- Solo se puede enviar como uno mismo, y solo en un hilo del que se es parte.
create policy "messages_insert_participant"
  on public.messages for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (c.patient_id = public.current_patient_id()
             or c.doctor_id = public.current_doctor_id())
    )
  );

-- Marcar como leído. No se permite editar el cuerpo de un mensaje ya enviado.
create policy "messages_update_read_receipt"
  on public.messages for update
  to authenticated
  using (exists (
    select 1 from public.conversations c
    where c.id = conversation_id
      and (c.patient_id = public.current_patient_id()
           or c.doctor_id = public.current_doctor_id())
  ))
  with check (exists (
    select 1 from public.conversations c
    where c.id = conversation_id
      and (c.patient_id = public.current_patient_id()
           or c.doctor_id = public.current_doctor_id())
  ));

create policy "notifications_select_own"
  on public.notifications for select
  to authenticated
  using (user_id = auth.uid());

create policy "notifications_update_own"
  on public.notifications for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "notifications_delete_own"
  on public.notifications for delete
  to authenticated
  using (user_id = auth.uid());
