-- ROLLOUT DA SEQUÊNCIA (streak v1) — COLAR ESTE ARQUIVO INTEIRO NO SQL EDITOR E RODAR UMA VEZ.
--
-- ARQUIVO GERADO por scripts/montar-rollout-sequencia.mjs — não editar à mão.
--
-- É UMA transação: BEGIN, retrato do "antes", a migração 20261001120000_sequencia.sql (texto
-- idêntico), conferências e COMMIT. Se QUALQUER passo falhar, o erro aparece, o COMMIT não roda e
-- NADA é gravado — nesse caso, rodar `rollback;` sozinho para limpar a sessão e me mandar o erro.
-- Se tudo passar, a última tela mostra uma linha "SEQUÊNCIA APLICADA E CONFERIDA".
--
-- Durante os poucos segundos da transação, nenhum crédito de XP confirma (ele espera e segue).

begin;

-- ═══ PARTE 1/3 — ANTES DA MIGRAÇÃO (na MESMA transação) ════════════════════════════════════
--
-- 1. TRAVA o progresso contra crédito: `creditar_partida` grava em `progresso` antes de lançar no
--    ledger, então nenhum crédito confirma enquanto esta transação existir (leitura continua
--    livre até o ALTER da migração). O retrato abaixo fica estável até a conferência.
-- 2. RETRATO do que a migração NÃO pode mudar, numa tabela temporária que some no commit.
-- 3. RECUSA rodar se a sequência já existir ou se faltarem os papéis do progresso.
lock table public.progresso in share row exclusive mode;

create temp table rollout_sequencia_antes on commit drop as
select (select count(*) from public.progresso)                    as linhas_de_progresso,
       (select coalesce(sum(xp_total), 0) from public.progresso)  as xp_total,
       (select count(*) from public.xp_eventos)                   as lancamentos,
       (select coalesce(sum(xp_delta), 0) from public.xp_eventos) as xp_no_ledger,
       (select coalesce(max(id), 0) from public.xp_eventos)       as maior_lancamento,
       (select count(*) from king_private.partidas)               as partidas,
       (select coalesce(array_agg(n.nspname || '.' || p.proname order by n.nspname, p.proname), '{}')
          from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
         where p.prosecdef and n.nspname in ('public', 'king_private'))  as security_definer;

do $$
begin
  if to_regclass('king_private.sequencia_inicio') is not null
     or exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'progresso' and column_name like 'sequencia%')
     or exists (select 1 from pg_trigger where tgname = 'xp_eventos_sequencia') then
    raise exception 'ROLLOUT ABORTADO (parte 1): a sequência já existe neste banco. Nada foi alterado.';
  end if;
  if to_regrole('king_progress_owner') is null or to_regrole('king_server') is null then
    raise exception 'ROLLOUT ABORTADO (parte 1): papéis do progresso ausentes. Nada foi alterado.';
  end if;
end $$;

-- ═══ PARTE 2/3 — A MIGRAÇÃO, idêntica a supabase/migrations/20261001120000_sequencia.sql ═══
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
-- ══ SEM BACKFILL HISTÓRICO (decisão de produto) ══
--
-- A sequência passa a existir só a partir do ROLLOUT desta migração. Partidas e XP anteriores a
-- ela não criam sequência nem recorde, não definem último dia e não são reinterpretados. A
-- migração grava um MARCO (`king_private.sequencia_inicio`), uma vez e imutável:
--
--   aplicado_em            — o relógio do banco no instante do marco (`clock_timestamp()`, lido
--                            DEPOIS da trava do ALTER abaixo — não o início da transação);
--   ultimo_evento_anterior — o maior id do ledger nesse instante;
--   partidas_a_partir_de   — aplicado_em + 5 minutos: a MARGEM DE RELÓGIO.
--
-- Conta para a sequência só o lançamento POSTERIOR ao marco, de partida INICIADA a partir de
-- `partidas_a_partir_de`. Crédito atrasado de partida pré-rollout e partida que atravessou o
-- rollout ficam fora. Depois da migração, todo mundo começa com 0, 0, sem dia e sem partida. Sem
-- marco, não há sequência: a ausência dele falha FECHADO.
--
-- POR QUE A MARGEM: `iniciada_em` vem do relógio da VPS; o marco, do relógio do banco. Com a VPS
-- adiantada em Δ, uma partida que começou até Δ ANTES do rollout chegaria carimbada DEPOIS dele.
-- O crédito já aceita fim de partida até 5 minutos no futuro do banco — é a tolerância de relógio
-- que o sistema declara. Com a mesma tolerância aplicada ao marco, toda partida que conta começou,
-- no tempo real, depois do marco. O custo: partida iniciada nos 5 primeiros minutos não conta.
--
-- POR QUE NENHUM CRÉDITO "ESCAPA" DO MAIOR ID: `creditar_partida` grava em `progresso` ANTES de
-- lançar no ledger. O ALTER abaixo pede trava exclusiva em `progresso`, então espera todo crédito
-- em andamento terminar — e os que chegam depois esperam a migração. Quando o marco lê o maior id,
-- não existe id alocado e não confirmado; todo id futuro é maior.
--
-- ══ POR QUE DERIVADA DO LEDGER, E NÃO "+1" ══
--
-- O crédito chega pelo outbox do servidor, que pode atrasar e reordenar: a partida de ontem pode
-- ser creditada depois da de hoje. Um contador incremental erraria nesse caso, e erraria de novo a
-- cada retry mal deduplicado. Aqui a sequência é RECALCULADA a partir de `xp_eventos` posteriores
-- ao marco. Isso torna o resultado independente da ordem de chegada e idempotente por construção:
-- processar o mesmo fato de novo dá o mesmo número. `progresso` guarda só o retrato (atual,
-- recorde, último dia, partida que qualificou esse dia), conferível contra o ledger pós-marco.
--
-- ══ SÓ CRÉDITO DE PARTIDA ══
--
-- Hoje o único escritor do ledger é `creditar_partida`, e o único `motivo` é
-- 'partida_concluida'. A sequência não confia nisso de olhos fechados: ela exige o motivo de
-- partida E uma partida registrada com 2+ humanos. Uma origem futura de XP (bônus, evento, modo
-- solo) não qualifica dia sem uma mudança EXPLÍCITA aqui — e os testes S18/S19 falham antes.
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

-- ══ O MARCO DO ROLLOUT — uma linha só, gravada AGORA, e imutável ═══════════════════════════
-- Ver o cabeçalho: relógio lido depois da trava, maior id do ledger, margem de 5 minutos. Sem
-- acesso pela API, sem GRANT para ninguém. `create table` (sem IF NOT EXISTS) faz a migração
-- inteira falhar se o marco já existir: ele nasce uma vez por aplicação.
create table king_private.sequencia_inicio (
  unica                  boolean     primary key default true,
  aplicado_em            timestamptz not null,
  partidas_a_partir_de   timestamptz not null,
  ultimo_evento_anterior bigint      not null,
  constraint sequencia_inicio_unica  check (unica),
  constraint sequencia_inicio_margem check (partidas_a_partir_de = aplicado_em + interval '5 minutes')
);
alter table king_private.sequencia_inicio enable row level security;
insert into king_private.sequencia_inicio (aplicado_em, partidas_a_partir_de, ultimo_evento_anterior)
select t.agora, t.agora + interval '5 minutes', (select coalesce(max(e.id), 0) from public.xp_eventos as e)
  from (select clock_timestamp() as agora) as t;

-- Imutável enquanto existir: nem UPDATE, nem DELETE, nem TRUNCATE — nem o dono. Refazer o marco
-- é rollback + nova migração, à vista. (Uma 2ª linha esbarra na chave primária.)
create function king_private.sequencia_inicio_imutavel() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'o marco do rollout da sequência é imutável (para refazer: rollback e nova migração)'
    using errcode = '55000';
end $$;
create trigger sequencia_inicio_sem_alteracao
  before update or delete on king_private.sequencia_inicio
  for each row execute function king_private.sequencia_inicio_imutavel();
create trigger sequencia_inicio_sem_truncate
  before truncate on king_private.sequencia_inicio
  for each statement execute function king_private.sequencia_inicio_imutavel();

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

-- ══ A SEQUÊNCIA DE UM JOGADOR, A PARTIR DO LEDGER PÓS-ROLLOUT ═══════════════════════════════
-- Qualifica o dia: lançamento de PARTIDA ('partida_concluida', partida com 2+ humanos), com XP
-- positivo, lançado DEPOIS do marco e de partida INICIADA a partir de `partidas_a_partir_de`.
-- Nada anterior ao rollout entra (sem backfill), e nenhuma outra origem de XP entra.
-- Ilhas de dias consecutivos: com os dias numerados por `dense_rank` (o mesmo dia, o mesmo
-- número), `dia - número` é constante dentro de uma corrida e muda a cada buraco. Cada corrida
-- mede DIAS DISTINTOS, nunca partidas: a 2ª partida do dia cai na mesma ilha e no mesmo dia.
--   atual      — tamanho da corrida que termina no último dia qualificado
--   recorde    — a maior corrida desde o rollout
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
      cross join king_private.sequencia_inicio as m
     where e.player_id = p_player
       and e.xp_delta > 0
       and e.motivo = 'partida_concluida'
       and q.humanos >= 2
       and e.id > m.ultimo_evento_anterior
       and q.iniciada_em >= m.partidas_a_partir_de
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

-- ══ SEM BACKFILL ════════════════════════════════════════════════════════════════════════════
-- Nenhum UPDATE retrospectivo aqui, de propósito: as colunas novas nascem 0, 0, NULL, NULL para
-- todo mundo (os defaults acima), e o marco garante que o histórico também não volte pelo gatilho.

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

-- Leem o ledger e o marco: só o dono, pelo gatilho.
revoke all on function king_private.sequencia_de(uuid)           from public, anon, authenticated, king_server;
revoke all on function king_private.sequencia_apos_lancamento()  from public, anon, authenticated, king_server;
revoke all on function king_private.sequencia_inicio_imutavel()  from public, anon, authenticated, king_server;
revoke all on table king_private.sequencia_inicio                from public, anon, authenticated, king_server;

comment on column public.progresso.sequencia_atual is
  'Retrato: tamanho da corrida que termina em sequencia_ultimo_dia. O valor EFETIVO de hoje está em meu_progresso.';
comment on function king_private.sequencia_de(uuid) is
  'Sequência derivada do ledger PÓS-ROLLOUT (dias de São Paulo com XP positivo de partida online). Sem backfill; idempotente e independente da ordem de chegada.';
comment on table king_private.sequencia_inicio is
  'Marco do rollout da sequência, imutável: conta só lançamento posterior a ultimo_evento_anterior, de partida iniciada a partir de partidas_a_partir_de (aplicado_em + 5 min de margem de relógio). Sem backfill histórico.';

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
