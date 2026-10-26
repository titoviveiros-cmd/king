-- RETENÇÃO DAS LÁPIDES (Fase 9, E-2) — 30 dias, e nunca enquanto um crédito ainda puder lê-las.
--
-- ══ QUANDO UMA LÁPIDE AINDA É NECESSÁRIA ══
--
-- A lápide (`king_private.contas_excluidas`, 20261025130000) guarda o id aleatório de uma conta
-- excluída e a hora da exclusão. O crédito só a lê no passo 3, quando a chave estrangeira de um
-- jogador reprova — e só em partida AINDA NÃO registrada (a já registrada volta no passo 2). Então a
-- lápide de P serve enquanto puder chegar um crédito com P para uma partida nova, e quem pode trazê-lo
-- é só o servidor do jogo:
--
--   • uma pendência no OUTBOX dele, que não tem prazo: fica até o banco confirmar;
--   • um crédito em voo;
--   • uma SALA VIVA: o token só é conferido na ENTRADA, e a reserva do lobby devolve o assento sem
--     token — uma partida pode começar (e terminar) muito depois de um dos jogadores excluir a conta.
--
-- Por isso o SERVIDOR diz o que ainda está em aberto, e o BANCO só aceita tirar o que tem mais de
-- 30 dias — o prazo normal decidido pelo titular (opção B, 26/10/2026). Expurgo cego por relógio
-- (pg_cron) é proibido: apagaria a lápide de quem ainda tem crédito pendente.
--
-- ══ O QUE ESTE ARQUIVO CRIA ══
--
--   expurgo_das_lapides       UMA linha: o MARCADOR do outbox registrado e contadores sem dado
--                             pessoal. O marcador é um id aleatório que mora num arquivo dentro do
--                             diretório do outbox; um diretório trocado, desmontado ou recriado vazio
--                             tem outro marcador, e com ele nada sai ("vazio" ali não prova nada).
--   expurgar_lapides          a ÚNICA porta. Recebe o marcador e a lista dos jogadores que o servidor
--                             ainda tem em aberto (outbox, créditos em voo, salas vivas) e tira só
--                             lápide com mais de 720 h — 30 dias exatos, pelo relógio do BANCO, sem
--                             fuso nem horário de verão no meio — que não esteja na lista. EXECUTE só
--                             para `king_server`, que continua sem nenhum privilégio de tabela.
--   registrar_conta_excluida  (redefinida) a hora da lápide passa a ser a da exclusão MAIS RECENTE do
--                             id: um id que volta a existir e é excluído de novo não pode herdar a
--                             idade da primeira lápide e sair antes do prazo.
--
-- Fora daqui (e documentado no §22.11): apagar `public.players` à mão com a conta viva deixa uma
-- conta viva com lápide — pulada no crédito e, depois do expurgo, derrubando a mesa. Exclusão é só
-- pela conta (excluir-conta ou Authentication). O gatilho não consegue distinguir os dois casos: a
-- cascata da chave estrangeira dispara este gatilho no MESMO nível do comando de fora.
--
-- ══ APLICAÇÃO E ROLLBACK ══
--
-- SQL Editor do Supabase (papel `postgres`, membro de `king_progress_owner`). As conferências do fim
-- reprovam o arquivo inteiro se a função, o dono ou os privilégios não ficarem exatamente como aqui.
-- Rollback: supabase/rollback/20261026120000_retencao_das_lapides_rollback.sql.

set role king_progress_owner;

-- ══ O ESTADO DO EXPURGO ═════════════════════════════════════════════════════════════════════
-- Sem política de RLS e sem GRANT: só o dono lê, e só a função escreve. O rollback desta migração
-- MANTÉM o estado quando já houve remoção (é a prova de exclusão real): reaplicar reaproveita a linha.
create table if not exists king_private.expurgo_das_lapides (
  unica             boolean     primary key default true constraint expurgo_das_lapides_uma_linha check (unica),
  outbox            uuid,                                  -- marcador registrado; null = registrar na próxima rodada
  rodadas           bigint      not null default 0,
  lapides_removidas bigint      not null default 0,
  ultima_rodada     timestamptz
);
alter table king_private.expurgo_das_lapides enable row level security;
revoke all on table king_private.expurgo_das_lapides from public;
insert into king_private.expurgo_das_lapides (unica) values (true) on conflict (unica) do nothing;

-- ══ A PORTA DO EXPURGO ══════════════════════════════════════════════════════════════════════
create function king_private.expurgar_lapides(p_outbox uuid, p_protegidas uuid[])
returns table (removidas integer, retidas integer)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
declare
  -- 30 dias EXATOS (720 h) pelo relógio do banco: "30 days" mudaria com o fuso da sessão
  v_corte      timestamptz := now() - interval '720 hours';
  v_registrado uuid;
  v_removidas  integer;
  v_retidas    integer;
begin
  -- Sem marcador ou sem a lista inteira não há prova de nada: NULL nunca quer dizer "nada pendente".
  if p_outbox is null or p_protegidas is null or array_position(p_protegidas, null) is not null then
    raise exception 'expurgo sem o marcador do outbox ou sem a lista completa de protegidas' using errcode = '22023';
  end if;
  if cardinality(p_protegidas) > 40000 then
    raise exception 'lista de protegidas grande demais' using errcode = '22023';
  end if;

  -- A linha do estado, TRAVADA: duas rodadas nunca correm juntas, e o marcador não troca no meio.
  select e.outbox into v_registrado
    from king_private.expurgo_das_lapides as e
   where e.unica
     for update;
  if not found then
    raise exception 'estado do expurgo ausente' using errcode = 'KL002';
  end if;
  if v_registrado is null then
    update king_private.expurgo_das_lapides as e set outbox = p_outbox where e.unica;
  elsif v_registrado <> p_outbox then
    raise exception 'o outbox não é o registrado: nada foi expurgado' using errcode = 'KL001';
  end if;

  delete from king_private.contas_excluidas as x
   where x.excluida_em < v_corte
     and x.player_id <> all (p_protegidas);
  get diagnostics v_removidas = row_count;

  -- o que venceu e ficou: só as protegidas pela lista
  select count(*)::integer into v_retidas
    from king_private.contas_excluidas as x
   where x.excluida_em < v_corte;

  update king_private.expurgo_das_lapides as e
     set rodadas = e.rodadas + 1,
         lapides_removidas = e.lapides_removidas + v_removidas,
         ultima_rodada = now()
   where e.unica;

  return query select v_removidas, v_retidas;
end $$;

-- ══ A LÁPIDE, REDEFINIDA ════════════════════════════════════════════════════════════════════
-- Mesmo dono, mesmo SECURITY DEFINER (quem apaga a conta é o papel do Auth), mesmos privilégios: o
-- `create or replace` não mexe neles.
create or replace function king_private.registrar_conta_excluida() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into king_private.contas_excluidas as x (player_id) values (old.id)
  on conflict (player_id) do update set excluida_em = greatest(x.excluida_em, excluded.excluida_em);
  return null;
end $$;

reset role;

revoke all on function king_private.expurgar_lapides(uuid, uuid[]) from public, anon, authenticated, service_role;
grant execute on function king_private.expurgar_lapides(uuid, uuid[]) to king_server;

comment on table king_private.expurgo_das_lapides is
  'Estado do expurgo das lápides (E-2): marcador do outbox registrado e contadores. Sem dado pessoal.';
comment on function king_private.expurgar_lapides(uuid, uuid[]) is
  'Tira lápide com mais de 720 h que o servidor não cite como pendente. Só king_server executa.';

-- ══ CONFERÊNCIAS — qualquer divergência reprova o arquivo inteiro ═══════════════════════════
do $conferencias$
declare
  f regprocedure := 'king_private.expurgar_lapides(uuid,uuid[])'::regprocedure;
  g regprocedure := 'king_private.registrar_conta_excluida()'::regprocedure;
  papel text;
begin
  if (select pg_get_userbyid(p.proowner) from pg_proc as p where p.oid = f) <> 'king_progress_owner'
     or not (select p.prosecdef from pg_proc as p where p.oid = f)
     or (select p.proconfig from pg_proc as p where p.oid = f) is distinct from array['search_path=""', 'lock_timeout=5s'] then
    raise exception 'E-2 ABORTADA: dono, SECURITY DEFINER ou configuração da função de expurgo errados. Nada foi aplicado.';
  end if;
  if (select pg_get_userbyid(p.proowner) from pg_proc as p where p.oid = g) <> 'king_progress_owner'
     or not (select p.prosecdef from pg_proc as p where p.oid = g)
     or (select p.proconfig from pg_proc as p where p.oid = g) is distinct from array['search_path=""'] then
    raise exception 'E-2 ABORTADA: o gatilho da lápide perdeu dono, SECURITY DEFINER ou search_path. Nada foi aplicado.';
  end if;
  if not has_function_privilege('king_server', f, 'execute') then
    raise exception 'E-2 ABORTADA: king_server não executa a função de expurgo. Nada foi aplicado.';
  end if;
  if pg_has_role('king_server', 'king_progress_owner', 'MEMBER') then
    raise exception 'E-2 ABORTADA: king_server é membro do dono das lápides (SET ROLE escaparia de tudo). Nada foi aplicado.';
  end if;
  foreach papel in array array['public', 'anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(papel, f, 'execute') or has_function_privilege(papel, g, 'execute') then
      raise exception 'E-2 ABORTADA: % executa uma função da lápide (o REVOKE não valeu). Nada foi aplicado.', papel;
    end if;
  end loop;
  foreach papel in array array['public', 'anon', 'authenticated', 'service_role', 'king_server'] loop
    if has_table_privilege(papel, 'king_private.expurgo_das_lapides', 'select, insert, update, delete, truncate, references, trigger')
       or has_table_privilege(papel, 'king_private.contas_excluidas', 'select, insert, update, delete, truncate, references, trigger') then
      raise exception 'E-2 ABORTADA: % tem privilégio de tabela na lápide ou no estado do expurgo. Nada foi aplicado.', papel;
    end if;
  end loop;
  if (select count(*) from king_private.expurgo_das_lapides) <> 1 then
    raise exception 'E-2 ABORTADA: o estado do expurgo não nasceu com uma linha só. Nada foi aplicado.';
  end if;
end
$conferencias$;
