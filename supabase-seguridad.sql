-- Ejecutar una sola vez en Supabase > SQL Editor.
-- Función segura para saber si la persona conectada es administradora.
create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.usuarios
    where id = auth.uid() and rol = 'admin' and activo = true
  );
$$;

grant execute on function public.es_admin() to authenticated;

alter table public.usuarios enable row level security;
alter table public.horas enable row level security;

drop policy if exists "usuarios_ver" on public.usuarios;
create policy "usuarios_ver" on public.usuarios
for select to authenticated
using (id = auth.uid() or public.es_admin());

drop policy if exists "horas_ver" on public.horas;
create policy "horas_ver" on public.horas
for select to authenticated
using (usuario_id = auth.uid() or public.es_admin());

drop policy if exists "horas_agregar" on public.horas;
create policy "horas_agregar" on public.horas
for insert to authenticated
with check (usuario_id = auth.uid() or public.es_admin());

drop policy if exists "horas_modificar" on public.horas;
create policy "horas_modificar" on public.horas
for update to authenticated
using (usuario_id = auth.uid() or public.es_admin())
with check (usuario_id = auth.uid() or public.es_admin());

drop policy if exists "horas_borrar" on public.horas;
create policy "horas_borrar" on public.horas
for delete to authenticated
using (usuario_id = auth.uid() or public.es_admin());
