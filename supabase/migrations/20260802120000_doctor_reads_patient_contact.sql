-- =============================================================================
-- DoctorCita · El médico puede leer los datos de contacto de sus pacientes
-- =============================================================================
-- Hasta ahora un médico veía la ficha clínica de su paciente (`patients`) pero
-- no su nombre ni su teléfono, porque eso vive en `public.users` y su RLS es
-- "cada quien ve lo suyo". El resultado: una agenda con citas sin nombre.
--
-- Aquí la apertura SÍ está justificada, al revés que con el directorio público:
-- un médico necesita saber a quién atiende y cómo avisarle si cambia una cita.
-- Y el alcance es estrecho — solo los pacientes con los que tiene o tuvo una
-- cita, nunca el resto de usuarios de la plataforma.
-- =============================================================================

create policy "users_select_treating_doctor"
  on public.users for select
  to authenticated
  using (
    exists (
      select 1
      from public.patients p
      join public.appointments a on a.patient_id = p.id
      where p.user_id = users.id
        and a.doctor_id = public.current_doctor_id()
    )
  );

comment on policy "users_select_treating_doctor" on public.users is
  'Un médico lee el nombre y contacto de los pacientes que atiende. Se limita a quienes tienen una cita con él.';
