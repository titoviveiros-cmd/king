-- ROLLBACK da migração 20261001120000_sequencia.sql — fora de `supabase/migrations/` DE PROPÓSITO:
-- nenhum `db push` aplica isto. Só se roda à mão, no SQL Editor do Dashboard, se a sequência
-- precisar sair do ar.
--
-- O que ele faz: devolve `meu_progresso` às 5 colunas de antes, remove o gatilho, as funções e as
-- colunas da sequência. O XP e o ledger NÃO são tocados: a sequência é derivada deles, e reaplicar a
-- migração refaz o retrato a partir do ledger. Provado em `scripts/testar-progresso-sql.mjs` (S17).

begin;

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

alter table public.progresso
  drop constraint progresso_sequencia_coerente,
  drop constraint progresso_recorde_cobre_atual,
  drop constraint progresso_sequencia_nao_negativa,
  drop column sequencia_partida,
  drop column sequencia_ultimo_dia,
  drop column sequencia_recorde,
  drop column sequencia_atual;

reset role;

commit;
