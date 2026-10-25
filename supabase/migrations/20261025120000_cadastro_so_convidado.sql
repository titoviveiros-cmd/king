-- CONTA SÓ NASCE COMO CONVIDADO (Fase 9) — o gancho "Before User Created" do Supabase Auth.
--
-- ══ POR QUE ══
--
-- No KING, todo jogador nasce CONVIDADO (usuário anônimo) e, se quiser, PENDURA um Google ou uma
-- Apple no MESMO usuário (`linkIdentity`). Nenhum fluxo legítimo cria usuário a partir de Google ou
-- Apple. Este gancho recusa exatamente isso: um usuário que nasceria já com identidade google/apple.
--
-- É ele que faz "Já tenho uma conta" ser SÓ ENTRAR. O app tenta `signInWithIdToken` num cliente
-- isolado; se aquele Google/Apple não pertence a jogador nenhum, o Supabase — sem o gancho — CRIARIA
-- uma conta nova e vazia (paralela). Com o gancho, o servidor recusa ali mesmo, atomicamente, e nada
-- é criado. O app ainda confere do lado dele (uma conta que "nasceu com a identidade" é desfeita e
-- nunca adotada), mas a garantia de verdade é esta, no servidor.
--
-- ══ O QUE NÃO É RECUSADO ══
--
--   • o convidado anônimo — o caminho normal de todo jogador;
--   • `linkIdentity` — vincular não cria usuário, então o gancho nem roda;
--   • cadastro por e-mail/telefone, que o KING não oferece: desligar no painel (ver
--     docs/KING-MOBILE-RC.md), não aqui — recusar demais num gancho derruba o cadastro de convidado.
--
-- ══ NUNCA LANÇA ══
--
-- Um erro aqui dentro reprovaria TODO cadastro — inclusive o do convidado, e ninguém novo jogaria
-- online. Por isso o JSON é lido sem confiar em formato nenhum (ver os testes em
-- scripts/testar-cadastro-sql.mjs), e não há acesso a tabela.
--
-- ══ ATIVAÇÃO (manual, no painel do Supabase) ══
--
-- Authentication → Hooks → "Before User Created" → Postgres → public.king_antes_de_criar_usuario.
-- Sem ligar no painel, a função existe e não faz nada. Para desfazer: DESLIGAR no painel primeiro,
-- e só então rodar supabase/rollback/20261025120000_cadastro_so_convidado_rollback.sql.

create or replace function public.king_antes_de_criar_usuario(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_usuario     jsonb;
  v_meta        jsonb;
  v_provedores  jsonb;
  v_identidades jsonb;
  v_nasce_com_login boolean := false;
begin
  v_usuario := case when jsonb_typeof(event -> 'user') = 'object' then event -> 'user' else '{}'::jsonb end;
  v_meta    := case when jsonb_typeof(v_usuario -> 'app_metadata') = 'object' then v_usuario -> 'app_metadata' else '{}'::jsonb end;

  if v_meta ->> 'provider' in ('google', 'apple') then
    v_nasce_com_login := true;
  end if;

  v_provedores := v_meta -> 'providers';
  if jsonb_typeof(v_provedores) = 'array' and (v_provedores ? 'google' or v_provedores ? 'apple') then
    v_nasce_com_login := true;
  end if;

  v_identidades := v_usuario -> 'identities';
  if jsonb_typeof(v_identidades) = 'array' then
    if exists (
      select 1 from jsonb_array_elements(v_identidades) as i (valor)
       where jsonb_typeof(i.valor) = 'object' and i.valor ->> 'provider' in ('google', 'apple')
    ) then
      v_nasce_com_login := true;
    end if;
  end if;

  if v_nasce_com_login then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'KING: nenhuma conta com este login. Toda conta do KING nasce como convidado.'));
  end if;
  return '{}'::jsonb;
end;
$$;

-- Só o Auth chama. Ninguém pela API — nem a service_role, que recebe EXECUTE em toda função nova
-- de `public` pelos privilégios padrão do Supabase.
grant usage on schema public to supabase_auth_admin;
grant execute on function public.king_antes_de_criar_usuario(jsonb) to supabase_auth_admin;
revoke execute on function public.king_antes_de_criar_usuario(jsonb) from public, anon, authenticated, service_role;
