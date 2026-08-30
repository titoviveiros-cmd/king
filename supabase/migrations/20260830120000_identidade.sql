-- IDENTIDADE PERMANENTE DO KING — o mínimo, e nada além dele.
--
-- ══ O QUE ESTA MIGRAÇÃO CRIA, E O QUE ELA DELIBERADAMENTE NÃO CRIA ══
--
-- Cria: uma linha por pessoa, com o que o jogo precisa lembrar entre partidas hoje — como ela se
-- chama e que bicho escolheu. Nada mais.
--
-- Não cria: xp, nível, streak, conquistas, inventário, cosméticos, ranking. Todos já estão
-- aprovados conceitualmente e nenhum entra agora. A razão não é disciplina de escopo: é que cada
-- coluna criada antes da hora vira uma decisão tomada sem informação, e migrar coluna com dados
-- de produção dentro custa mais que criá-la depois. `players.id` é o ponto de amarração de todas
-- elas quando chegarem — uma tabela nova com `player_id REFERENCES players(id)` e pronto.
--
-- ══ POR QUE `id` REFERENCIA `auth.users` EM VEZ DE SER UM UUID PRÓPRIO ══
--
-- Um segundo identificador significaria uma tabela de tradução para manter em sincronia, com um
-- modo de falha silencioso: as duas se desencontram e ninguém percebe até alguém perder progresso.
-- O `auth.users.id` já é imutável, já é único e já é emitido por quem tem autoridade — é o mesmo
-- valor que chega ao Colyseus no claim `sub` do token. Um valor, uma verdade.
--
-- ══ A AUTORIDADE DA PARTIDA NÃO MORA AQUI ══
--
-- O RLS abaixo protege o PERFIL: ninguém edita o de outro pela API do Supabase. Ele não sabe nada
-- sobre KING, vaza, trunfo ou pontuação, e não deve saber. Quem decide partida é o Colyseus, e
-- mover regra de jogo para política de banco criaria duas autoridades para a mesma coisa.

create table if not exists public.players (
  -- O `playerId` canônico. Mesmo valor do `sub` do JWT.
  id uuid primary key references auth.users (id) on delete cascade,

  -- Como a pessoa aparece na mesa. O KING já limita o apelido a 14 caracteres na interface; o
  -- banco repete o limite porque interface não é validação.
  display_name text check (display_name is null or char_length(display_name) between 1 and 14),

  -- A última escolha de bicho, como PREFERÊNCIA — não como identidade. Quem manda no avatar de
  -- uma partida é a sala: ela garante exclusividade entre os quatro assentos, e duas pessoas com
  -- a mesma preferência precisam continuar podendo entrar na mesma mesa.
  avatar_id text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.players is
  'Perfil persistente do KING, 1:1 com auth.users. A autoridade da partida é o Colyseus.';
comment on column public.players.avatar_id is
  'Preferência de avatar, não identidade — a exclusividade por mesa é decidida na sala.';

-- `updated_at` que não depende de ninguém lembrar de escrevê-lo.
create or replace function public.tocar_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists players_touch on public.players;
create trigger players_touch
  before update on public.players
  for each row execute function public.tocar_updated_at();

-- ══ RLS ══
--
-- Cada um enxerga e edita o PRÓPRIO perfil, e só. Sem isto, qualquer pessoa com a chave pública
-- (que vai dentro do APK, por definição) poderia reescrever o perfil de qualquer outra.
alter table public.players enable row level security;

drop policy if exists "cada um lê o próprio perfil" on public.players;
create policy "cada um lê o próprio perfil"
  on public.players for select
  using (auth.uid() = id);

drop policy if exists "cada um cria o próprio perfil" on public.players;
create policy "cada um cria o próprio perfil"
  on public.players for insert
  with check (auth.uid() = id);

drop policy if exists "cada um atualiza o próprio perfil" on public.players;
create policy "cada um atualiza o próprio perfil"
  on public.players for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Nenhuma política de DELETE: apagar perfil é assunto de pedido de exclusão de conta, que tem
-- fluxo próprio e vem com a política de privacidade. Sem política, o RLS nega por padrão.

-- ══ O PERFIL NASCE COM A CONTA ══
--
-- Inclusive para sessão anônima: o convidado é uma identidade de verdade, com `auth.users.id`
-- próprio, e precisa de perfil desde o primeiro acesso — é o que permite vincular o Google depois
-- SEM perder o que veio antes.
create or replace function public.criar_player()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.players (id) values (new.id) on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.criar_player();
