
-- ═══ PARTE 3/3 — CONFERÊNCIAS, AINDA DENTRO DA TRANSAÇÃO ═══════════════════════════════════
--
-- Qualquer falha aqui levanta erro: o COMMIT abaixo não roda e NADA da migração é gravado.
-- (O SQL Editor não mostra NOTICE; quem fala é o erro, ou o relatório no fim.)
do $$
declare
  antes  record;
  marco  record;
  n      bigint;
  lista  text[];
begin
  select * into antes from rollout_sequencia_antes;

  -- 1. XP, ledger e partidas: nada do que existia mudou
  if (select count(*) from public.progresso) <> antes.linhas_de_progresso
     or (select coalesce(sum(xp_total), 0) from public.progresso) <> antes.xp_total
     or (select count(*) from public.xp_eventos) <> antes.lancamentos
     or (select coalesce(sum(xp_delta), 0) from public.xp_eventos) <> antes.xp_no_ledger
     or (select coalesce(max(id), 0) from public.xp_eventos) <> antes.maior_lancamento
     or (select count(*) from king_private.partidas) <> antes.partidas then
    raise exception 'CONFERÊNCIA 1 FALHOU: XP, ledger ou partidas mudaram. Nada foi gravado.';
  end if;

  -- 2. SEM BACKFILL: ninguém nasceu com sequência — nem no retrato, nem no recálculo do ledger
  select count(*) into n from public.progresso
   where sequencia_atual <> 0 or sequencia_recorde <> 0
      or sequencia_ultimo_dia is not null or sequencia_partida is not null;
  if n <> 0 then
    raise exception 'CONFERÊNCIA 2 FALHOU: % jogador(es) nasceram com sequência. Nada foi gravado.', n;
  end if;
  select count(*) into n
    from public.progresso as g cross join lateral king_private.sequencia_de(g.player_id) as s
   where s.atual <> 0 or s.recorde <> 0 or s.ultimo_dia is not null or s.partida is not null;
  if n <> 0 then
    raise exception 'CONFERÊNCIA 2 FALHOU: o recálculo enxerga histórico de % jogador(es). Nada foi gravado.', n;
  end if;

  -- 3. o marco: um só, coerente, deste instante
  select count(*) into n from king_private.sequencia_inicio;
  if n <> 1 then
    raise exception 'CONFERÊNCIA 3 FALHOU: % marco(s) de rollout. Nada foi gravado.', n;
  end if;
  select * into marco from king_private.sequencia_inicio;
  if marco.ultimo_evento_anterior <> antes.maior_lancamento
     or marco.partidas_a_partir_de <> marco.aplicado_em + interval '5 minutes'
     or marco.aplicado_em < now() or marco.aplicado_em > clock_timestamp() then
    raise exception 'CONFERÊNCIA 3 FALHOU: marco incoerente (%). Nada foi gravado.', row_to_json(marco);
  end if;

  -- 4. os gatilhos: o da sequência no ledger e os dois de imutabilidade do marco, todos ligados
  if not exists (select 1 from pg_trigger
                  where tgname = 'xp_eventos_sequencia' and tgrelid = 'public.xp_eventos'::regclass and tgenabled = 'O')
     or (select count(*) from pg_trigger
          where tgrelid = 'king_private.sequencia_inicio'::regclass and not tgisinternal and tgenabled = 'O') <> 2 then
    raise exception 'CONFERÊNCIA 4 FALHOU: gatilhos ausentes ou desligados. Nada foi gravado.';
  end if;

  -- 5. a leitura do jogador: colunas antigas na frente, novas no fim
  if (select string_agg(column_name::text, ',' order by ordinal_position) from information_schema.columns
       where table_schema = 'public' and table_name = 'meu_progresso')
     is distinct from 'player_id,xp_total,nivel,xp_no_nivel,xp_do_nivel,sequencia_atual,sequencia_recorde,sequencia_hoje,sequencia_ultimo_dia,sequencia_partida' then
    raise exception 'CONFERÊNCIA 5 FALHOU: colunas de meu_progresso. Nada foi gravado.';
  end if;

  -- 6. permissões de tabela: só o jogador lê o próprio progresso; escrita para ninguém da API
  if has_table_privilege('anon', 'public.meu_progresso', 'SELECT')
     or not has_table_privilege('authenticated', 'public.meu_progresso', 'SELECT') then
    raise exception 'CONFERÊNCIA 6 FALHOU: leitura de meu_progresso. Nada foi gravado.';
  end if;
  if exists (
    select 1
      from unnest(array['anon', 'authenticated', 'service_role', 'king_server']) as r (papel),
           unnest(array['public.progresso', 'public.xp_eventos', 'king_private.sequencia_inicio']) as t (tabela),
           unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as p (privilegio)
     where to_regrole(r.papel) is not null and has_table_privilege(r.papel, t.tabela, p.privilegio)) then
    raise exception 'CONFERÊNCIA 6 FALHOU: escrita aberta em progresso, ledger ou marco. Nada foi gravado.';
  end if;
  if exists (
    select 1
      from unnest(array['anon', 'authenticated', 'service_role', 'king_server']) as r (papel)
     where to_regrole(r.papel) is not null
       and has_table_privilege(r.papel, 'king_private.sequencia_inicio', 'SELECT')) then
    raise exception 'CONFERÊNCIA 6 FALHOU: o marco é legível pela API. Nada foi gravado.';
  end if;

  -- 7. permissões de execução das funções novas
  if exists (
    select 1
      from unnest(array['anon', 'service_role', 'king_server']) as r (papel),
           unnest(array['public.dia_de_sao_paulo(timestamptz)', 'public.sequencia_efetiva(integer, date, timestamptz)',
                        'public.sequencia_qualificada_hoje(date, timestamptz)', 'king_private.sequencia_de(uuid)',
                        'king_private.sequencia_apos_lancamento()', 'king_private.sequencia_inicio_imutavel()']) as f (funcao)
     where to_regrole(r.papel) is not null and has_function_privilege(r.papel, f.funcao, 'EXECUTE')) then
    raise exception 'CONFERÊNCIA 7 FALHOU: função nova executável por anon, service_role ou king_server. Nada foi gravado.';
  end if;
  if exists (
    select 1
      from unnest(array['king_private.sequencia_de(uuid)', 'king_private.sequencia_apos_lancamento()',
                        'king_private.sequencia_inicio_imutavel()']) as f (funcao)
     where has_function_privilege('authenticated', f.funcao, 'EXECUTE')) then
    raise exception 'CONFERÊNCIA 7 FALHOU: função privada executável pelo jogador. Nada foi gravado.';
  end if;
  if not has_function_privilege('king_server',
       'king_private.creditar_partida(uuid, timestamptz, timestamptz, smallint, smallint, jsonb)', 'EXECUTE') then
    raise exception 'CONFERÊNCIA 7 FALHOU: o servidor perdeu a porta do crédito. Nada foi gravado.';
  end if;

  -- 8. nenhuma função SECURITY DEFINER nova; as novas com search_path vazio e dono dedicado
  select coalesce(array_agg(n2.nspname || '.' || p.proname order by n2.nspname, p.proname), '{}') into lista
    from pg_proc as p join pg_namespace as n2 on n2.oid = p.pronamespace
   where p.prosecdef and n2.nspname in ('public', 'king_private');
  if lista is distinct from antes.security_definer then
    raise exception 'CONFERÊNCIA 8 FALHOU: funções SECURITY DEFINER mudaram (% → %). Nada foi gravado.', antes.security_definer, lista;
  end if;
  if exists (
    select 1 from pg_proc as p join pg_namespace as n2 on n2.oid = p.pronamespace
     where (n2.nspname, p.proname) in (('public', 'dia_de_sao_paulo'), ('public', 'sequencia_efetiva'),
                                       ('public', 'sequencia_qualificada_hoje'), ('king_private', 'sequencia_de'),
                                       ('king_private', 'sequencia_apos_lancamento'), ('king_private', 'sequencia_inicio_imutavel'))
       and (p.proconfig is distinct from array['search_path=""'] or pg_get_userbyid(p.proowner) <> 'king_progress_owner')) then
    raise exception 'CONFERÊNCIA 8 FALHOU: função nova sem search_path vazio ou fora do dono dedicado. Nada foi gravado.';
  end if;
end $$;

commit;

-- ═══ RELATÓRIO — só aparece se TUDO acima passou e foi gravado ════════════════════════════
select 'SEQUÊNCIA APLICADA E CONFERIDA' as resultado,
       m.aplicado_em,
       m.partidas_a_partir_de,
       m.ultimo_evento_anterior,
       (select count(*) from public.progresso
         where sequencia_atual <> 0 or sequencia_recorde <> 0 or sequencia_ultimo_dia is not null) as jogadores_com_sequencia,
       (select count(*) from public.progresso)                   as linhas_de_progresso,
       (select coalesce(sum(xp_total), 0) from public.progresso) as xp_total,
       (select count(*) from public.xp_eventos)                  as lancamentos
  from king_private.sequencia_inicio as m;
