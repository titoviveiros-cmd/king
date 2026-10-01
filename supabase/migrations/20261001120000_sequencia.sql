-- SEQUÊNCIA DO KING (streak v1) — dias seguidos com XP, derivados do ledger.
--
-- ══ A REGRA ══
--
-- Sequência = dias CONSECUTIVOS do calendário de São Paulo (America/Sao_Paulo — a mesma referência
-- diária da regra de XP) em que o jogador recebeu pelo menos UM crédito de XP POSITIVO. O crédito é
-- o de `king_private.creditar_partida`: durável, autoritativo e idempotente. Ele só existe em
-- partida online com 2+ humanos. Partida local ou solo, contra bots, nunca gera crédito e, portanto,
-- nunca conta. Abandono, participação insuficiente e partida sobreposta rendem 0 XP e também não
-- contam.
--
--   primeiro dia qualificado     → 1
--   qualificou ontem             → +1
--   já qualificou hoje           → igual (a 2ª partida do dia dá XP, mas não mexe na sequência)
--   um dia ou mais sem qualificar → a próxima qualificação recomeça em 1
--   recorde                      = o maior valor que a sequência já teve; nunca diminui
--
-- Nada de congelamento, dia de graça, recuperação paga, bônus, moeda, prêmio ou notificação.
--
-- ══ POR QUE DERIVADA DO LEDGER, E NÃO "+1" ══
--
-- O crédito chega pelo outbox do servidor, que pode atrasar e reordenar: a partida de ontem pode
-- ser creditada depois da de hoje. Um contador incremental erraria nesse caso, e erraria de novo a
-- cada retry mal deduplicado. Aqui a sequência é RECALCULADA a partir de `xp_eventos`, que é a
-- verdade do XP. Isso torna o resultado independente da ordem de chegada e idempotente por
-- construção: processar o mesmo fato de novo dá o mesmo número. `progresso` guarda só o retrato
-- (atual, recorde, último dia, partida que qualificou esse dia), conferível contra o ledger, como
-- o `xp_total`.
--
-- ══ QUEM ESCREVE ══
--
-- Ninguém de fora. Um gatilho em `xp_eventos` recalcula a sequência dos jogadores lançados, na
-- MESMA transação e DEPOIS da trava por jogador de `creditar_partida`. XP e sequência são gravados
-- juntos ou não são gravados. A função de crédito não muda: nenhuma porta nova, nenhum endpoint e
-- nenhum GRANT de escrita.
--
-- ══ ARMAZENADA × EFETIVA ══
--
-- O retrato guardado envelhece. Quem qualificou anteontem pela última vez tem a sequência QUEBRADA
-- hoje, mesmo com `sequencia_atual = 5` gravado. A view `meu_progresso` devolve o valor EFETIVO,
-- calculado com o relógio do BANCO (`now()`): o cliente não decide nada e não repete a regra de
-- calendário.

set role king_progress_owner;

-- ══ O RETRATO, NA LINHA DE PROGRESSO QUE JÁ EXISTE ══════════════════════════════════════════
-- Default constante: no Postgres 11+ isto não reescreve a tabela.
alter table public.progresso
  add column sequencia_atual      integer not null default 0,
  add column sequencia_recorde    integer not null default 0,
  add column sequencia_ultimo_dia date,
  add column sequencia_partida    uuid,
  add constraint progresso_sequencia_nao_negativa check (sequencia_atual >= 0),
  add constraint progresso_recorde_cobre_atual    check (sequencia_recorde >= sequencia_atual),
  -- "nunca qualificou" é UM estado só: sem dia, sem partida, sequência 0
  add constraint progresso_sequencia_coerente     check (
    (sequencia_ultimo_dia is null) = (sequencia_partida is null)
    and (sequencia_ultimo_dia is null) = (sequencia_atual = 0)
  );

reset role;

-- As funções públicas abaixo nascem do dono dedicado, como `nivel_de`. Ele precisa, só durante
-- esta migração, criar objetos em `public`.
grant create on schema public to king_progress_owner;
set role king_progress_owner;

-- ══ O DIA DO KING — uma definição só ════════════════════════════════════════════════════════
-- A mesma conta que `creditar_partida` faz para a redução após 6 partidas no dia.
create function public.dia_de_sao_paulo(p_instante timestamptz) returns date
language sql stable strict
set search_path = ''
as $$
  select (p_instante at time zone 'America/Sao_Paulo')::date
$$;

-- ══ A SEQUÊNCIA DE UM JOGADOR, A PARTIR DO LEDGER ═══════════════════════════════════════════
-- Ilhas de dias consecutivos: com os dias numerados por `dense_rank` (o mesmo dia, o mesmo
-- número), `dia - número` é constante dentro de uma corrida e muda a cada buraco. Cada corrida
-- mede DIAS DISTINTOS, nunca partidas: a 2ª partida do dia cai na mesma ilha e no mesmo dia.
--   atual      — tamanho da corrida que termina no último dia qualificado
--   recorde    — a maior corrida do histórico
--   ultimo_dia — o último dia qualificado
--   partida    — a PRIMEIRA partida creditada (ordem do ledger) que qualificou esse dia; a 2ª
--                partida do mesmo dia nunca toma o lugar dela
create function king_private.sequencia_de(p_player uuid)
returns table (atual integer, recorde integer, ultimo_dia date, partida uuid)
language sql stable
set search_path = ''
as $$
  with qualificadas as (
    select public.dia_de_sao_paulo(q.terminada_em) as dia, e.id, e.partida_id
      from public.xp_eventos as e
      join king_private.partidas as q on q.id = e.partida_id
     where e.player_id = p_player
       and e.xp_delta > 0
  ),
  ilhas as (
    select d.dia, d.dia - (dense_rank() over (order by d.dia))::integer as ilha from qualificadas as d
  ),
  corridas as (
    select max(i.dia) as fim, count(distinct i.dia)::integer as tamanho from ilhas as i group by i.ilha
  )
  select coalesce((select c.tamanho from corridas as c order by c.fim desc limit 1), 0),
         coalesce((select max(c.tamanho) from corridas as c), 0),
         (select max(c.fim) from corridas as c),
         (select d.partida_id from qualificadas as d order by d.dia desc, d.id limit 1)
$$;

-- ══ O GATILHO — recalcula quem acabou de ser lançado ════════════════════════════════════════
-- Por COMANDO, não por linha: uma partida lança até 4 jogadores num INSERT só. Roda com os
-- privilégios de quem inseriu, e quem insere é `creditar_partida`, como `king_progress_owner`,
-- depois da trava por jogador. Não é SECURITY DEFINER: não precisa, e assim não vira uma porta de
-- escrita para mais ninguém. Recalcular também quem levou 0 XP é inofensivo: o ledger desse
-- jogador não ganhou dia novo, e o resultado é o mesmo de antes.
create function king_private.sequencia_apos_lancamento() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.progresso as g
     set sequencia_atual      = s.atual,
         sequencia_recorde    = greatest(g.sequencia_recorde, s.recorde),
         sequencia_ultimo_dia = s.ultimo_dia,
         sequencia_partida    = s.partida
    from (select distinct n.player_id from novos as n) as j
    cross join lateral king_private.sequencia_de(j.player_id) as s
   where g.player_id = j.player_id;
  return null;
end $$;

create trigger xp_eventos_sequencia
  after insert on public.xp_eventos
  referencing new table as novos
  for each statement
  execute function king_private.sequencia_apos_lancamento();

-- ══ O VALOR EFETIVO — com o relógio de quem pergunta, que é o banco ═════════════════════════
-- Puras: recebem o instante, para que os testes fixem o relógio. A view passa `now()`.
create function public.sequencia_efetiva(p_atual integer, p_ultimo_dia date, p_agora timestamptz) returns integer
language sql stable
set search_path = ''
as $$
  select case when p_ultimo_dia >= public.dia_de_sao_paulo(p_agora) - 1 then p_atual else 0 end
$$;

create function public.sequencia_qualificada_hoje(p_ultimo_dia date, p_agora timestamptz) returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce(p_ultimo_dia >= public.dia_de_sao_paulo(p_agora), false)
$$;

reset role;

revoke create on schema public from king_progress_owner;

-- ══ O RETRATO DE QUEM JÁ JOGOU ══════════════════════════════════════════════════════════════
-- Quem já tem XP antes desta migração tem os dias no ledger. Sem este passo a Home mostraria 0 até
-- o próximo crédito, e o próximo crédito recalcularia do ledger de qualquer jeito. O retrato nasce
-- já igual ao que o ledger diz.
update public.progresso as g
   set sequencia_atual      = s.atual,
       sequencia_recorde    = greatest(g.sequencia_recorde, s.recorde),
       sequencia_ultimo_dia = s.ultimo_dia,
       sequencia_partida    = s.partida
  from public.progresso as p
  cross join lateral king_private.sequencia_de(p.player_id) as s
 where g.player_id = p.player_id;

-- ══ LEITURA DO PRÓPRIO PROGRESSO, AGORA COM A SEQUÊNCIA ═════════════════════════════════════
-- As colunas antigas ficam iguais, em nome, tipo e ordem; as novas entram no fim. Um cliente que
-- pede só as antigas continua funcionando, e um cliente que pede `*` num banco SEM esta migração
-- simplesmente não recebe as novas.
create or replace view public.meu_progresso with (security_invoker = true) as
select eu.uid                                                                    as player_id,
       x.xp_total,
       public.nivel_de(x.xp_total)                                               as nivel,
       (x.xp_total - public.xp_para_nivel(public.nivel_de(x.xp_total)))::integer as xp_no_nivel,
       (public.xp_para_nivel(public.nivel_de(x.xp_total) + 1)
          - public.xp_para_nivel(public.nivel_de(x.xp_total)))::integer          as xp_do_nivel,
       public.sequencia_efetiva(x.sequencia_atual, x.sequencia_ultimo_dia, now()) as sequencia_atual,
       x.sequencia_recorde,
       public.sequencia_qualificada_hoje(x.sequencia_ultimo_dia, now())          as sequencia_hoje,
       x.sequencia_ultimo_dia,
       x.sequencia_partida
  from (select auth.uid() as uid) as eu
  cross join lateral (
    select coalesce(g.xp_total, 0)          as xp_total,
           coalesce(g.sequencia_atual, 0)   as sequencia_atual,
           coalesce(g.sequencia_recorde, 0) as sequencia_recorde,
           g.sequencia_ultimo_dia,
           g.sequencia_partida
      from (select 1) as um
      left join public.progresso as g on g.player_id = eu.uid
  ) as x
 where eu.uid is not null;

-- ══ GRANTS — todos explícitos ═══════════════════════════════════════════════════════════════
-- `create or replace view` mantém os privilégios; o revoke/grant abaixo deixa isso à vista.
revoke all on table public.meu_progresso from public, anon, authenticated;
grant select on table public.meu_progresso to authenticated;

-- Puras e sem acesso a dado: a view, que roda como o próprio jogador, precisa executá-las.
revoke all on function public.dia_de_sao_paulo(timestamptz)                     from public, anon, authenticated;
revoke all on function public.sequencia_efetiva(integer, date, timestamptz)     from public, anon, authenticated;
revoke all on function public.sequencia_qualificada_hoje(date, timestamptz)     from public, anon, authenticated;
grant execute on function public.dia_de_sao_paulo(timestamptz)                  to authenticated;
grant execute on function public.sequencia_efetiva(integer, date, timestamptz)  to authenticated;
grant execute on function public.sequencia_qualificada_hoje(date, timestamptz)  to authenticated;

-- Leem o ledger: só o dono, pelo gatilho.
revoke all on function king_private.sequencia_de(uuid)           from public, anon, authenticated, king_server;
revoke all on function king_private.sequencia_apos_lancamento()  from public, anon, authenticated, king_server;

comment on column public.progresso.sequencia_atual is
  'Retrato: tamanho da corrida que termina em sequencia_ultimo_dia. O valor EFETIVO de hoje está em meu_progresso.';
comment on function king_private.sequencia_de(uuid) is
  'Sequência derivada do ledger (dias de São Paulo com XP positivo). Idempotente e independente da ordem de chegada.';
