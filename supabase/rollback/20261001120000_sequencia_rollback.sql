-- ROLLBACK da migração 20261001120000_sequencia.sql — fora de `supabase/migrations/` DE PROPÓSITO:
-- nenhum `db push` aplica isto. Só se roda à mão, no SQL Editor do Dashboard, se a sequência
-- precisar sair do ar. COLAR O ARQUIVO INTEIRO E RODAR UMA VEZ.
--
-- O que ele faz: devolve `meu_progresso` às 5 colunas de antes e remove o gatilho, as funções, o
-- marco do rollout e as colunas da sequência — só objetos da sequência. O XP, o ledger e as
-- partidas NÃO são tocados, e nada é recalculado. Reaplicar a migração grava um marco NOVO: tudo
-- o que veio antes dele — inclusive o que contou na primeira aplicação — vira histórico, e a
-- sequência recomeça do zero, sem reconstrução. Provado em `scripts/testar-progresso-sql.mjs`
-- (S17, S22, S23).
--
-- É UMA transação, com conferência no fim: se algo falhar, o erro aparece e NADA é gravado (nesse
-- caso, rodar `rollback;` sozinho para limpar a sessão). Se tudo passar, a última tela mostra
-- "SEQUÊNCIA REMOVIDA E CONFERIDA". A web publicada continua funcionando nos dois estados: ela
-- lê `meu_progresso` com `select=*` e, sem as colunas novas, mostra o card de antes.

begin;

-- Trava o progresso contra crédito e fotografa o que o rollback NÃO pode mudar.
lock table public.progresso in share row exclusive mode;
create temp table rollback_sequencia_antes on commit drop as
select (select count(*) from public.progresso)                    as linhas_de_progresso,
       (select coalesce(sum(xp_total), 0) from public.progresso)  as xp_total,
       (select count(*) from public.xp_eventos)                   as lancamentos,
       (select coalesce(sum(xp_delta), 0) from public.xp_eventos) as xp_no_ledger,
       (select coalesce(max(id), 0) from public.xp_eventos)       as maior_lancamento,
       (select count(*) from king_private.partidas)               as partidas;

-- A view primeiro: ela depende das colunas e das funções. `create or replace` não remove coluna,
-- então ela é recriada exatamente como em 20260925120000_progresso.sql.
drop view public.meu_progresso;
create view public.meu_progresso with (security_invoker = true) as
select auth.uid()                                                               as player_id,
       x.xp_total,
       public.nivel_de(x.xp_total)                                              as nivel,
       (x.xp_total - public.xp_para_nivel(public.nivel_de(x.xp_total)))::integer as xp_no_nivel,
       (public.xp_para_nivel(public.nivel_de(x.xp_total) + 1)
          - public.xp_para_nivel(public.nivel_de(x.xp_total)))::integer          as xp_do_nivel
  from (
    select coalesce((select g.xp_total from public.progresso as g where g.player_id = auth.uid()), 0) as xp_total
  ) as x
 where auth.uid() is not null;
revoke all on table public.meu_progresso from public, anon, authenticated;
grant select on table public.meu_progresso to authenticated;

-- O resto pertence ao dono dedicado, como na migração.
set role king_progress_owner;

drop trigger xp_eventos_sequencia on public.xp_eventos;
drop function king_private.sequencia_apos_lancamento();
drop function king_private.sequencia_de(uuid);
drop function public.sequencia_qualificada_hoje(date, timestamptz);
drop function public.sequencia_efetiva(integer, date, timestamptz);
drop function public.dia_de_sao_paulo(timestamptz);
-- o marco (os gatilhos de imutabilidade dele caem junto com a tabela) e a função desses gatilhos
drop table king_private.sequencia_inicio;
drop function king_private.sequencia_inicio_imutavel();

alter table public.progresso
  drop constraint progresso_sequencia_coerente,
  drop constraint progresso_recorde_cobre_atual,
  drop constraint progresso_sequencia_nao_negativa,
  drop column sequencia_partida,
  drop column sequencia_ultimo_dia,
  drop column sequencia_recorde,
  drop column sequencia_atual;

reset role;

-- Conferências, ainda dentro da transação: qualquer falha desfaz tudo.
do $$
declare
  antes record;
begin
  select * into antes from rollback_sequencia_antes;
  if (select count(*) from public.progresso) <> antes.linhas_de_progresso
     or (select coalesce(sum(xp_total), 0) from public.progresso) <> antes.xp_total
     or (select count(*) from public.xp_eventos) <> antes.lancamentos
     or (select coalesce(sum(xp_delta), 0) from public.xp_eventos) <> antes.xp_no_ledger
     or (select coalesce(max(id), 0) from public.xp_eventos) <> antes.maior_lancamento
     or (select count(*) from king_private.partidas) <> antes.partidas then
    raise exception 'CONFERÊNCIA DO ROLLBACK FALHOU: XP, ledger ou partidas mudaram. Nada foi gravado.';
  end if;
  if to_regclass('king_private.sequencia_inicio') is not null
     or exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'progresso' and column_name like 'sequencia%')
     or exists (select 1 from pg_trigger where tgname = 'xp_eventos_sequencia')
     or exists (select 1 from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
                 where n.nspname in ('public', 'king_private')
                   and p.proname in ('dia_de_sao_paulo', 'sequencia_efetiva', 'sequencia_qualificada_hoje',
                                     'sequencia_de', 'sequencia_apos_lancamento', 'sequencia_inicio_imutavel')) then
    raise exception 'CONFERÊNCIA DO ROLLBACK FALHOU: sobrou objeto da sequência. Nada foi gravado.';
  end if;
  if (select string_agg(column_name::text, ',' order by ordinal_position) from information_schema.columns
       where table_schema = 'public' and table_name = 'meu_progresso')
     is distinct from 'player_id,xp_total,nivel,xp_no_nivel,xp_do_nivel'
     or has_table_privilege('anon', 'public.meu_progresso', 'SELECT')
     or not has_table_privilege('authenticated', 'public.meu_progresso', 'SELECT') then
    raise exception 'CONFERÊNCIA DO ROLLBACK FALHOU: meu_progresso não voltou ao original. Nada foi gravado.';
  end if;
end $$;

commit;

select 'SEQUÊNCIA REMOVIDA E CONFERIDA' as resultado,
       (select count(*) from public.progresso)                   as linhas_de_progresso,
       (select coalesce(sum(xp_total), 0) from public.progresso) as xp_total,
       (select count(*) from public.xp_eventos)                  as lancamentos;
