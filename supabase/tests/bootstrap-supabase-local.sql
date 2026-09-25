-- EMULAÇÃO MÍNIMA DO SUPABASE — SÓ PARA O POSTGRES DESCARTÁVEL DOS TESTES LOCAIS.
--
-- NUNCA aplicar em projeto Supabase: lá tudo isto já existe, e é justamente o que ele emula.
-- As migrações de `supabase/migrations/` NÃO dependem deste arquivo; ele só fornece a um Postgres
-- puro o que o Supabase fornece de fábrica:
--
--   • papéis `anon` e `authenticated`;
--   • schema `auth`, com `auth.users` (só o id) e `auth.uid()` lendo `request.jwt.claims`,
--     o mesmo mecanismo do Supabase;
--   • os PRIVILÉGIOS PADRÃO permissivos do Supabase em `public` — tabelas, funções e sequências
--     nascem com acesso para `anon` e `authenticated`.
--
-- O último item é deliberado: um Postgres puro não concede nada a ninguém, e os testes passariam
-- por omissão. Com os padrões do Supabase reproduzidos, os testes provam que os REVOKE/GRANT
-- explícitos da migração vencem o ambiente hostil — que é o que vai acontecer em produção.

do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid
$$;

grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;

-- Os padrões do Supabase, reproduzidos para o papel que aplica as migrações.
alter default privileges in schema public grant all on tables    to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
