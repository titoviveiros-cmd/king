-- ROLLBACK de 20261026120000_retencao_das_lapides.sql (E-2) — tira o EXPURGO, e só ele.
--
-- O que volta: a função da lápide ao texto do passo D (20261025130000). O que sai: a função de
-- expurgo. O que FICA, sempre: as lápides, o gatilho e a função de crédito — sem o expurgo, nenhuma
-- lápide sai mais (falha segura: o servidor registra "expurgo das lápides falhou: 42883/transitoria" e
-- mantém tudo).
--
-- O ESTADO DO EXPURGO (só contadores) fica quando alguma lápide já foi removida: é a prova de que
-- houve exclusão real de conta, e é ele que mantém o rollback pré-E do passo D recusando. Sem
-- nenhuma remoção, ele sai junto.
--
-- Uma transação: qualquer divergência levanta "ROLLBACK E-2 ABORTADO"/"CONFERÊNCIA N FALHOU" e NADA
-- é aplicado — nesse caso, parar e não rodar outro SQL. Um erro de trava ("lock timeout") também não
-- aplica nada: um expurgo estava no meio; rodar de novo um minuto depois. Esperado na última tela:
-- "ROLLBACK E-2 APLICADO".
begin;

set local lock_timeout = '5s';

do $preflight$
begin
  if not pg_has_role(current_user, 'king_progress_owner', 'MEMBER') or not pg_has_role(current_user, 'king_progress_owner', 'USAGE') then
    raise exception 'ROLLBACK E-2 ABORTADO: % não herda king_progress_owner. Nada foi alterado.', current_user;
  end if;
  if to_regprocedure('king_private.expurgar_lapides(uuid,uuid[])') is null
     or to_regclass('king_private.expurgo_das_lapides') is null then
    raise exception 'ROLLBACK E-2 ABORTADO: a retenção das lápides não está aplicada — nada a fazer. Nada foi alterado.';
  end if;
end
$preflight$;

-- O ESTADO PRIMEIRO, em modo exclusive: um expurgo em andamento termina antes, e um novo espera o fim
-- daqui já na linha do estado — sem isto, ele seguraria o estado enquanto esperava a lápide, e o DROP
-- abaixo fecharia um ciclo (40P01). Depois a lápide: nem expurgo nem exclusão de conta mudam a contagem.
lock table king_private.expurgo_das_lapides in exclusive mode;
lock table king_private.contas_excluidas in share mode;

create temp table rollback_e2_antes on commit drop as
select (select count(*) from king_private.contas_excluidas)               as lapides,
       (select e.lapides_removidas from king_private.expurgo_das_lapides as e) as ja_removidas;

set role king_progress_owner;

drop function king_private.expurgar_lapides(uuid, uuid[]);

create or replace function king_private.registrar_conta_excluida() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into king_private.contas_excluidas (player_id) values (old.id)
  on conflict (player_id) do nothing;
  return null;
end $$;

reset role;

-- Com o papel original (membro do dono): a tabela temporária é dele, e o DROP vale pela herança.
do $estado$
begin
  if (select a.ja_removidas from rollback_e2_antes as a) = 0 then
    drop table king_private.expurgo_das_lapides;
  end if;
end
$estado$;

do $conferencias$
declare
  a record;
begin
  select * into a from rollback_e2_antes;
  if current_user <> session_user then
    raise exception 'CONFERÊNCIA 0 FALHOU: a sessão não voltou ao papel original (%). Nada foi gravado.', current_user;
  end if;
  if to_regprocedure('king_private.expurgar_lapides(uuid,uuid[])') is not null then
    raise exception 'CONFERÊNCIA 1 FALHOU: a função de expurgo continua lá. Nada foi gravado.';
  end if;
  if (select count(*) from king_private.contas_excluidas) <> a.lapides
     or not exists (select 1 from pg_trigger as tg where tg.tgname = 'players_lapide_da_exclusao'
                     and tg.tgrelid = 'public.players'::regclass and tg.tgenabled = 'O')
     or position('do nothing' in pg_get_functiondef('king_private.registrar_conta_excluida()'::regprocedure)) = 0 then
    raise exception 'CONFERÊNCIA 2 FALHOU: as lápides, o gatilho ou a função da lápide não ficaram como no passo D. Nada foi gravado.';
  end if;
  if (a.ja_removidas = 0) <> (to_regclass('king_private.expurgo_das_lapides') is null) then
    raise exception 'CONFERÊNCIA 3 FALHOU: o estado do expurgo não seguiu a regra (sai só sem remoção). Nada foi gravado.';
  end if;
end
$conferencias$;

commit;

select 'ROLLBACK E-2 APLICADO' as resultado,
       to_regprocedure('king_private.expurgar_lapides(uuid,uuid[])') is null as sem_expurgo,
       (select count(*) from king_private.contas_excluidas)                as lapides_preservadas,
       to_regclass('king_private.expurgo_das_lapides') is not null          as estado_mantido;
