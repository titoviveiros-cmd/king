# KING — Analytics

O que o KING mede, como, com quem, e o que ele **não** mede. Escrito a partir do código e de
execuções reais (Fase 4F, setembro/2026).

> **Estado em 30/09/2026 — FASE 4F-B1.1** (GeoIP desligado; retenção factual: janela de consulta de 12 meses, sem teto de exclusão, §15). **4F-B1:** O **Preview** da branch `feat/analytics-v1` está conectado
> ao projeto PostHog **KING (US Cloud, "Discard client IP data" ligado)**: `VITE_POSTHOG_KEY` e
> `VITE_POSTHOG_HOST` existem na Vercel **só no ambiente Preview e só para essa branch**.
> **Production continua sem destino**: sem as duas variáveis, o adaptador é o silêncio e o SDK nem
> é baixado. A página pública de privacidade existe (`/privacidade`, §16). Ligar em Production é a
> Fase 4F-B2. Prova real do Preview: §17.
>
> ⚠️ Nada aqui é redação jurídica.

---

## 1. Decisões desta fase

| Decisão | Escolha | Por quê |
|---|---|---|
| Fornecedor | **PostHog Cloud** | funis, retenção e stickiness prontos; SDK web que roda igual no WebView do Capacitor |
| Identidade | **anônima** — só o `distinct_id` aleatório que o SDK gera e guarda no aparelho | medir comportamento e retenção **neste navegador/aparelho** sem perfil de pessoa |
| `identify()` | **nunca** chamado | identificar exige decisão explícita posterior + política atualizada (§5) |
| Coleta automática | **nenhuma** — sem autocapture, pageview, pageleave, heatmap, replay, surveys, web vitals, exceções | cada evento responde uma pergunta de produto; o resto é ruído e risco |
| Acoplamento | componentes **não** conhecem o SDK | tudo passa por `src/analytics/`; trocar de fornecedor é trocar um adaptador |
| Falha | **nunca** afeta o jogo | sem configuração, lento, bloqueado, fora do ar ou barrado por adblock: o jogo é o mesmo |

North Star inicial: **jogadores que concluem uma partida** (`match_finished`, usuários únicos).

---

## 2. Arquitetura

```
componente React ──► analytics.track(evento, props)          src/analytics/analytics.ts
                          │  (ou: anunciarAbertura / anunciarInicioDePartida / anunciarFimDePartida)
                          ▼
                     esquema do evento  ─ chave fora do esquema: descartada
                     lista proibida     ─ nick, roomCode, playerId, userId, email, token, url…: descartada
                     formato do valor   ─ rótulo curto minúsculo / inteiro no intervalo / booleano
                          │
                          ▼  + CONTEXTO (platform, environment, traffic_type, first_*)
                     adaptador
                       ├─ silencioso  (padrão; sem VITE_POSTHOG_* nada sai e nada é baixado)
                       └─ PostHog     src/analytics/posthog.ts — fila curta, NO pacote inicial
                               │ import() dinâmico, só com configuração válida
                               ▼
                          src/analytics/posthogSdk.ts + posthog-js (slim, no-external) — SOB DEMANDA
                               │ init UMA vez, configuração restritiva (§3)
                               ▼
                          before_send  ─ última barreira: só eventos do KING, props revalidadas,
                               │         sem URL/referrer/pessoa, $process_person_profile = false
                               ▼
                          POST {VITE_POSTHOG_HOST}/e/
```

| Arquivo | Papel | No pacote inicial? |
|---|---|---|
| `analytics/analytics.ts` | eventos, esquema, lista proibida, `track` à prova de falha | sim |
| `analytics/contexto.ts` | plataforma, ambiente, tráfego real/teste | sim |
| `analytics/aquisicao.ts` | utm + domínio do referrer, normalizados | sim |
| `analytics/memoria.ts` | memória local (primeira abertura, primeiro toque, primeira partida, partidas já anunciadas) — **nunca enviada** | sim |
| `analytics/partida.ts` | `match_started` / `first_match_started` / `match_finished` sem duplicar | sim |
| `analytics/iniciar.ts` | escolhe destino e contexto; `app_open` | sim |
| `analytics/posthog.ts` | validação da configuração + fila até o SDK chegar | sim (~1 kB) |
| `analytics/posthogSdk.ts` | configuração do SDK, `before_send`, `init` | **não** — sob demanda |

**Impacto no bundle** (build de produção, medido nesta fase contra a `main` 206cb7b):

| (KiB = 1024 bytes) | antes (main) | depois (4F) | diferença |
|---|---|---|---|
| JS inicial | 235,4 KiB · gz 76,5 KiB | 243,0 KiB · gz 79,5 KiB | **+7,6 KiB · gz +3,0 KiB** (a camada de medição, igual com ou sem chave) |
| SDK + config + filtro | — | 159,4 KiB · gz 51,5 KiB | **sob demanda**, só com `VITE_POSTHOG_*` válidas |

A variante `module.slim.no-external` tem **menos da metade** do `posthog-js` padrão (`module.js`, 310 KiB).

---

## 3. Configuração do SDK

`posthog-js` **1.434.17, versão exata** (sem `^`: atualizar é decisão, não acidente), variante
`dist/module.slim.no-external.js`. A slim traz só o núcleo; **autocapture, replay, surveys,
heatmaps, web vitals, exceções, toolbar e feature flags são extensões que ela não contém** e que o
KING não passa. A `no-external` não baixa script de terceiros. Cada nome de opção abaixo foi
conferido no tipo `PostHogConfig` instalado — o TypeScript recusa nome inexistente (provado: um
nome inventado dá `TS2353`).

| Opção | Valor | Por quê |
|---|---|---|
| `autocapture`, `capture_pageview`, `capture_pageleave`, `rageclick`, `capture_dead_clicks`, `capture_heatmaps`, `capture_performance`, `capture_exceptions` | `false` | nenhuma coleta automática |
| `disable_scroll_properties` | `true` | idem |
| `disable_session_recording`, `disable_surveys`, `disable_surveys_automatic_display`, `disable_product_tours`, `disable_conversations`, `disable_web_experiments` | `true` | produtos fora do escopo |
| `disable_external_dependency_loading` | `true` | nenhum script externo |
| `advanced_disable_flags`, `advanced_disable_feature_flags` | `true` | **sem pedido `/flags`** — e, com isso, nenhuma configuração remota liga coisa alguma pelo painel |
| `person_profiles` | `"identified_only"` | sem `identify`, nenhum perfil de pessoa nasce |
| `persistence` | `"localStorage"` | sem cookie |
| `save_referrer`, `save_campaign_params` | `false` | o SDK não guarda referrer nem campanha |
| `mask_personal_data_properties` + `custom_personal_data_properties` | `true` + apelido, e-mail, código, token… | o SDK guarda a URL de entrada no aparelho (propriedades da sessão); com a máscara, ids de clique e parâmetros sensíveis ficam mascarados até lá |
| `request_batching` | `false` | cada evento sai na hora — são poucos por sessão, e no celular o app vai para segundo plano sem aviso |
| `before_send` | `filtrarEventoDoPostHog` | a última barreira (§6) |
| `debug` | `false` | nada no console em produção |

> **IP:** a opção `ip` do SDK **não tem efeito** (documentado no próprio tipo). O descarte de IP é
> uma configuração do **projeto** no PostHog — ver §13, item obrigatório.
>
> **GeoIP: DESLIGADO (decisão do Tito, 30/09/2026 — minimização de dados).** A prova real de 29/09
> mostrou que, mesmo com o IP descartado, a ingestão gravava `$geoip_country/subdivision/city`,
> `$geoip_postal_code`, `$geoip_latitude/longitude` e `$geoip_time_zone`. Não queremos nenhum deles.
>
> - **Mecanismo:** o `before_send` põe **`$geoip_disable: true` em todo evento**, forçado (um evento
>   que tente mandar `false` sai com `true`). A transformação de GeoIP do PostHog pula o evento que
>   traz essa propriedade.
> - **Por que assim:** o `posthog-js` 1.434.17 **não tem opção de configuração** para GeoIP no
>   `PostHogConfig` (conferido nos tipos instalados). O mecanismo é o mesmo que o núcleo do próprio
>   SDK usa na opção `disableGeoip` dos outros SDKs: `@posthog/core`, `posthog-core-stateless.ts`,
>   `prepareMessage` → `message.properties['$geoip_disable'] = true`.
> - **Guardado por teste:** unitário (todo evento sai com `true`, inclusive contra `false`), e2e com o
>   SDK real (todo corpo enviado traz `$geoip_disable: true` e nenhuma outra chave de localização) e
>   três mutações.

O SDK também **descarta sozinho** eventos de navegador automatizado (`navigator.webdriver` ou user
agent `HeadlessChrome`). Automação não vira dado nem por engano — e mesmo que escape desse filtro,
chega marcada como `traffic_type=test` (§9).

---

## 4. Eventos

Conjunto **fechado e tipado** (`EVENTOS` em `analytics.ts`). Evento fora da lista não compila e,
se forçado, não sai.

| Evento | Pergunta de produto | Propriedades | Onde dispara |
|---|---|---|---|
| `app_open` | quantos abrem, de onde vieram, **quantos voltam** (retenção) | `first_open`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `referrer_host` | uma vez por página (`main.tsx` → `App`) |
| `tutorial_started` | quem procura aprender? | `passo` (onde retomou) | ao abrir o APRENDA KING |
| `tutorial_completed` | o tutorial é concluído? | — | último passo |
| `first_match_started` | **ativação**: quantos chegam a jogar a primeira partida | `modo` | **uma vez por instalação**, junto do 1º `match_started` |
| `match_started` | quantas partidas começam, em que modo, com quantas pessoas | `modo`, `humanos`, `bots` | local: ao começar; online: ao chegar o 1º estado de uma partida nova |
| `match_finished` | **North Star**: quantos terminam; em que posição | `modo`, `posicao` (1..4), `empate` | ao montar o Placar Final |
| `room_created` | o multiplayer é procurado? | — | **depois** de a sala abrir de fato |
| `room_joined` | convites viram gente na mesa? | — | **depois** de entrar de fato (voltar para a própria sala **não** conta) |
| `invite_code_copied` | o convite é repassado? | — | **depois** de a cópia dar certo |
| `result_shared` | o resultado circula? | `method`: `native_share` \| `clipboard` | **depois** de compartilhar/copiar com sucesso; desistir da folha não conta |
| `disconnect` / `reconnect` | a conexão aguenta? | `modo` | queda / volta do WebSocket |
| `rematch_clicked` | quem quer outra? (por posição) | `modo`, `posicao` | botão Revanche / Jogar novamente |
| `social_message_sent` | as frases sociais são usadas? | `mensagem` (etiqueta do catálogo fechado) | ao enviar |

**Fora de propósito:**
- `second_session`, `d1`, `d7` — **não são eventos**: são métricas derivadas de `app_open` (§8).
- `invite_shared` — o KING **não tem** link de convite nem folha de compartilhar o convite; o único
  gesto de convite hoje é copiar o código (`invite_code_copied`). O evento entra junto com o fluxo,
  se ele existir. Um evento declarado que nunca dispara seria um zero enganoso no painel.

**Sem duplicar:** `app_open` tem trava por página; `first_match_started` tem marca local gravada
**antes** do envio (clique duplo e StrictMode não repetem); a partida online é deduplicada pelo id
da partida guardado **só no aparelho** — um reload no meio da partida ou no Placar Final não conta
a mesma partida de novo (provado no e2e).

---

## 5. Identidade anônima

- O `distinct_id` é um UUIDv7 **aleatório** gerado pelo SDK na primeira carga, guardado em
  `localStorage` (`ph_<token>_posthog`). Não deriva de nada da pessoa.
- **Nunca** vai: id do Supabase (`auth.users.id`/`sub`), `playerId`, apelido, e-mail, código de
  sala, `recoveryToken`, token de acesso, id da partida, id do ledger de XP.
- `$process_person_profile` sai **sempre `false`** (forçado no `before_send`): nenhum perfil de
  pessoa nasce, nem se alguém chamar `identify` por engano no futuro.
- **Consequências (aceitas):** o mesmo jogador no celular e no computador são dois `distinct_id`;
  limpar o navegador ou reinstalar o app gera um novo; web e app são distintos.
- **Indisponível com eventos anônimos** (doc oficial do PostHog): **lifecycle** e **coortes**.
  Tendências, funis, retenção e stickiness funcionam.
- **Identificar no futuro** exige: decisão explícita, política de privacidade atualizada **antes**,
  e trocar a regra do `before_send`. A arquitetura permite — o ponto é um só (`posthogSdk.ts`).

---

## 6. Propriedades — o que PODE sair

**Contexto** (em todo evento):

| Propriedade | Valores | Origem |
|---|---|---|
| `platform` | `web` \| `capacitor_android` \| `capacitor_ios` | objeto `Capacitor` injetado pelo runtime nativo (sem importar `@capacitor/core`) |
| `environment` | `production` \| `preview` \| `development` | `VITE_KING_AMBIENTE` → senão `VERCEL_ENV` do build → senão `development` |
| `traffic_type` | `real` \| `test` | §9 |
| `first_utm_source`, `first_utm_medium`, `first_utm_campaign`, `first_referrer_host` | rótulos | primeiro toque neste aparelho (§7) |

**Técnicas do SDK que sobrevivem ao `before_send`:** `token` (público), `distinct_id`,
`$device_id` (= o mesmo id anônimo), `$session_id`, `$window_id`, `$insert_id`, `$time`, `$lib`,
`$lib_version`, `$is_identified` (sempre falso), `$os`, `$os_version`, `$browser`,
`$browser_version`, `$device_type`, e `$process_person_profile=false`.

**Formatos:** rótulo = `[a-z0-9_.:-]`, curto, e **sem cara de identificador** (só dígitos, hexa
longo, uuid ou `@` são descartados); inteiros só no intervalo do esquema; booleanos só booleanos.
Valor fora do formato é **descartado, nunca cortado**.

### O que NÃO sai — nunca

`$current_url`, `$pathname`, `$host`, `$referrer`, `$referring_domain`, `$initial_*`, **qualquer
`$geoip_*` (o PostHog nem calcula: `$geoip_disable: true`)**, `$set`,
`$set_once`, `$unset`, user agent bruto, tamanho de tela, fuso, ids de clique (`gclid`, `fbclid`…),
`utm_term`, URL completa, texto compartilhado, apelido, código de sala, qualquer id de conta,
jogador, partida ou lançamento de XP, placar bruto, texto livre de qualquer tipo.

Três barreiras, cada uma com teste que fica vermelho sem ela (§12): **esquema por evento** →
**lista proibida** → **`before_send`**.

---

## 7. Aquisição (first touch)

- Da URL de entrada saem **só** `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`; do
  referrer, **só o domínio** (`referrer_host`, sem `www.`, sem caminho, sem query; navegação
  interna não conta; `android-app://` conta — é como o Android informa "veio do Gmail/WhatsApp").
- Normalização: minúsculo, sem acento, espaço → `_`, até 64 caracteres, só `[a-z0-9_.-]`. O que
  não couber é descartado. `"Promoção de Verão"` → `promocao_de_verao`; `utm_content=0315` some
  (cara de código de sala).
- **Current touch:** o `app_open` leva as utm/referrer **desta** abertura.
- **First touch:** a primeira abertura grava o toque na memória local; ele vai como `first_*` em
  **todo** evento. Como não há perfil de pessoa, é assim que dá para recortar *partidas concluídas*
  ou *retenção* pela origem. Um toque vazio é a visita direta.
- **Ressalva:** o first touch começa a contar no dia em que o PostHog for ligado. Quem já jogava
  antes terá como primeiro toque a primeira visita **depois** disso, e `first_open=true` nela.

---

## 8. Sessão e retenção

- **Sessão** = `$session_id` do SDK: 30 min sem evento abre uma sessão nova (padrão do SDK).
- **Retenção** sai de `app_open` + `distinct_id` persistente. `app_open` sai uma vez por carga de
  página (e por abertura do app). Nenhum evento artificial de "segunda sessão", D1 ou D7.
- **Segunda sessão** = o mesmo `distinct_id` com `app_open` em **dois `$session_id` diferentes**
  (um reload dentro de 30 min é a mesma sessão, não conta).

---

## 9. Ambientes e tráfego de teste

`environment`: builds da Vercel sabem se são `production` ou `preview` (`VERCEL_ENV`, copiado para
o pacote pelo `vite.config.ts`). Build feito à mão é `development` — nunca se passa por produção.
**Build de loja (Capacitor) precisa de `VITE_KING_AMBIENTE=production`**, porque não passa pela Vercel.

`traffic_type=test` quando **qualquer** sinal aparecer. **Só Production pode ser tráfego real** — a
primeira linha garante isso sem depender de ninguém lembrar de marcar nada:

| Sinal | Quem usa |
|---|---|
| `environment` diferente de `production` | **todo Preview e todo build de desenvolvimento** — sempre teste |
| `VITE_KING_TRAFEGO=test` no build | **todos os builds de e2e** (`.env.e2e`, `.env.e2e-progresso`, `.env.e2e-analytics`) |
| `navigator.webdriver` | qualquer automação |
| `?trafego=teste` na URL — **fica marcado** no navegador até `?trafego=real` | **provas e smoke manuais em Production** — abrir uma vez `https://playkingcards.com.br/?trafego=teste` antes de testar |
| `?seed=` ou `?mao=` na URL | ganchos de teste do modo local |

Os 2 convidados de teste da 4E (Production) **não** entram no PostHog: são anteriores a ele.

---

## 10. Dashboard "KING — Early Growth" (especificação)

**Filtro do dashboard inteiro:** `environment = production` **E** `traffic_type = real`.
Recomendado criar uma *Action* "Sala (criada ou entrada)" = `room_created` OU `room_joined`.

| # | Insight | Tipo | Configuração |
|---|---|---|---|
| 1 | **North Star** | Tendências | `match_finished`, agregação **usuários únicos**, intervalo semana (e dia); quebra opcional por `modo` |
| 2 | **Ativação** | Funil | `app_open` (onde `first_open = true`) → `first_match_started` → `match_finished`; janela 7 dias; por usuários únicos |
| 3 | **Multiplayer** | Funil | `app_open` → Action "Sala (criada ou entrada)" → `match_started` (`modo = online`) → `match_finished` (`modo = online`); janela 1 dia |
| 4 | **Taxa de conclusão** | Funil | `match_started` → `match_finished`; janela 2 h; quebra por `modo` |
| 5 | **Retenção D1** | Retenção | evento inicial `app_open` (**primeira vez**), evento de retorno `app_open`, período **dia**; ler a coluna Dia 1 |
| 6 | **Retenção D7** | Retenção | igual ao 5; ler a coluna Dia 7 (e, com período **semana**, a Semana 1) |
| 7 | **Segunda sessão** | SQL (HogQL) | ver consulta abaixo |
| 8 | **Origem** | Funil 2 e Retenção 5 | quebra por `first_utm_source`, depois `first_utm_campaign`, depois `first_referrer_host` |
| 9 | **Convite e compartilhamento** | Tendências | `invite_code_copied`, `room_joined`, `result_shared` (quebra por `method`); fórmula `room_joined / room_created` |
| 10 | **Saúde da reconexão** | Tendências + Funil | `disconnect` e `reconnect` por dia; fórmula `reconnect / disconnect`; funil `disconnect` → `reconnect` janela 2 min |

Consulta da **segunda sessão** (novos usuários do período que tiveram ≥ 2 sessões em 7 dias). Escrita
para o editor SQL do PostHog (HogQL); conferir a sintaxe lá na 4F-B, com os primeiros dados:

```sql
WITH novos AS (
  SELECT distinct_id, min(timestamp) AS primeira
  FROM events
  WHERE event = 'app_open'
    AND properties.first_open = true
    AND properties.environment = 'production'
    AND properties.traffic_type = 'real'
    AND timestamp >= now() - INTERVAL 30 DAY
  GROUP BY distinct_id
)
SELECT
  count() AS novos,
  countIf(sessoes >= 2) AS voltaram,
  round(100 * voltaram / novos, 1) AS pct_segunda_sessao
FROM (
  SELECT n.distinct_id, uniq(e.properties.$session_id) AS sessoes
  FROM novos n
  JOIN events e ON e.distinct_id = n.distinct_id
  WHERE e.event = 'app_open'
    AND e.timestamp BETWEEN n.primeira AND n.primeira + INTERVAL 7 DAY
  GROUP BY n.distinct_id
)
```

Stickiness (quantos dias por semana cada um abre) fica para quando houver volume: *Stickiness* de
`app_open`, período semana, mesmos filtros.

---

## 11. Mobile (Capacitor)

- **Mesmo código, mesmo esquema.** A plataforma vem do objeto `Capacitor` que o runtime nativo
  injeta; nenhum plugin novo.
- Persistência em `localStorage` da WebView (o id anônimo sobrevive entre aberturas do app;
  some ao limpar dados ou reinstalar).
- `request_batching: false`: nada fica esperando lote quando o app vai para segundo plano; o SDK
  ainda descarrega em `pagehide`.
- `VITE_POSTHOG_HOST` precisa ser **absoluto** (`https://…`): a origem do app é `capacitor://localhost`
  / `https://localhost`, então um caminho relativo de proxy não serviria.
- **Fora desta fase, de propósito:** Adjust, AppsFlyer, Firebase Analytics, IDFA/ATT, Advertising
  ID. Só entram se houver necessidade real de atribuição de instalação nas lojas.

---

## 12. Testes

| Suíte | O que prova |
|---|---|
| `src/analytics/*.test.ts` (Vitest, 108) | esquema, lista proibida, formatos, contexto, aquisição, memória, partidas, dedupe, init único, silêncio sem configuração, `phx_` recusada, configuração do SDK, `before_send`, fila, falhas absorvidas, estrutura (SDK só sob demanda, nenhum `identify` no app, pontos de captura no lugar certo, analytics sem Supabase) |
| `tests-analytics/` (Playwright, SDK **de verdade**, host fictício interceptado) | `app_open` como sai na rede; nada além de `POST /e/`; `first_match_started` 1× com reload; partida local até o fim + compartilhar por método + revanche; online 2 humanos + 2 bots com reload sem recontar; PostHog bloqueado / fora / SDK que não chega → jogo igual; navegador automatizado → SDK descarta |
| `scripts/mutar-analytics.mjs` | cada proteção crítica tem teste que fica **vermelho** sem ela (`--e2e` inclui as cobradas pelo SDK real) |

```bash
npm run test --workspace apps/web                  # unitários
npm run test:e2e:analytics --workspace apps/web    # e2e com o SDK real
npm run test:mutacao:analytics                     # mutações (unit + e2e)
```

---

## 13. Ligar o PostHog (Fase 4F-B) — checklist

1. ✅ *(Tito, 29/09)* Projeto **KING** no PostHog Cloud, região **US**.
2. ✅ *(Tito, 29/09)* **Settings → Project → IP data capture → "Discard client IP data": LIGADO.** O IP
   não é guardado; a localização aproximada (GeoIP) continua sendo derivada na ingestão.
3. No projeto, deixar desligados autocapture, session replay, heatmaps, surveys, web vitals e
   exception autocapture (defesa em profundidade; o cliente já não pede configuração remota).
4. Copiar o **Project token** (`phc_…`, público) e o **host de ingestão** (`https://us.i.posthog.com`).
   Nunca a *Personal API key* (`phx_…`) — o app a recusa.
5. Vercel → projeto `king-web` → Environment Variables:
   - ✅ **Preview** *(4F-B1)*: `VITE_POSTHOG_KEY` e `VITE_POSTHOG_HOST`, tipo Config, **só para a
     branch `feat/analytics-v1`**. Todo evento do Preview sai `environment=preview` e
     `traffic_type=test` (§9).
   - ⏸️ **Production** *(4F-B2)*: as mesmas duas, **só depois** do item 6.
6. A página `/privacidade` (§16) precisa estar **no ar em Production antes** de ligar a medição lá.
7. Deploy; abrir `https://playkingcards.com.br/?trafego=teste`; conferir no *Activity* do PostHog
   um `app_open` com `environment=production` e `traffic_type=test`.
8. Montar o dashboard da §10.

## 14. Como desligar (kill switch) — sem mexer em código

- **Remover `VITE_POSTHOG_KEY`** das variáveis da Vercel e **Redeploy**. O build sai com o adaptador
  silencioso: o SDK nem entra no download.
- Mais rápido ainda: **Instant Rollback** da Vercel para um deployment sem a variável.
- O jogo não depende do analytics em nenhum desses caminhos.

## 15. Impacto na política de privacidade (não é texto jurídico)

> **Feito na 4F-B1/4F-B1.1:** a página pública `/privacidade` já diz tudo abaixo, **menos a
> retenção** (§16), e declara o GeoIP desligado.
>
> **RETENÇÃO — a discrepância encontrada (30/09/2026).** A decisão do Tito é **12 meses**. Mas o PostHog
> Cloud **não oferece mecanismo que garanta esse teto**. A documentação oficial
> ([Events data retention](https://posthog.com/docs/data/events-retention)) diz:
> - retenção por plano: **Free = 1 ano**, pagos = 7 anos; as consultas só enxergam eventos dentro
>   da janela;
> - **"Retention is not a deletion tool"** — a página não afirma que o dado mais velho é apagado;
> - **"You cannot make your retention period shorter to remove data, and a shorter period is not
>   available on request"** — não há configuração nem pedido que encurte;
> - nada sobre retenção **máxima**. Em outro trecho da doc, depois de 1 ano o dado "pode" ir para
>   armazenamento frio e "pode" ser apagado.
>
> Ou seja: 1 ano é **piso de consulta**, não **teto de guarda**.
>
> ✅ **DECISÃO FINAL (Tito, 30/09/2026 — opção 2): texto factual, SEM teto de exclusão.**
> - **Janela consultável atual (plano Free): 12 meses.** É o que o KING consegue analisar.
> - Isso **não** equivale a expurgo garantido: o **PostHog pode manter os dados armazenados por
>   período superior**, conforme a infraestrutura e as políticas dele.
> - **Nenhuma promessa** de exclusão automática em 12 meses — o KING não controla o prazo técnico de
>   exclusão do fornecedor, e a página diz exatamente isso.
> - Texto público (`/privacidade`, "Por quanto tempo"): *"utilizamos atualmente o plano do PostHog
>   cuja janela de consulta dos eventos é de até 12 meses […] Isso não é um prazo de exclusão: o
>   PostHog pode manter esses dados armazenados por período superior, conforme sua própria
>   infraestrutura e políticas de retenção, e o KING não controla esse prazo técnico de exclusão."*
> - Guardado por teste: `src/ui/privacidade.test.ts` exige a janela, a ressalva e o "não controla",
>   aceita como prazo só a janela de consulta e proíbe teto ("no máximo", "retenção máxima",
>   "excluídos após 12 meses", "mantidos por até…"). Mutações A/B/C no runner.
> - ⚠️ **Mudar de plano muda a janela** (pagos = 7 anos): trocar o plano exige atualizar a página
>   ANTES. Se um dia houver **garantia contratual ou técnica de exclusão**, a política pode ser
>   endurecida (e os testes junto).

Antes de ligar em Production, a política precisa dizer: que há **medição de uso anônima**; o
**fornecedor** (PostHog, como operador) e a **região** dos dados; que o identificador é **aleatório,
por aparelho/navegador**, sem vínculo com a conta de jogo; que **o IP não é guardado**; o que é
medido (a lista da §4 em linguagem simples) e o que não é (§6); retenção dos eventos (configuração
do projeto PostHog); como desligar (limpar dados do navegador/app). Nas lojas: Data Safety /
Privacy Labels passam a declarar **uso do app / interações** e um **identificador** — sem uso para
publicidade e sem rastreamento entre apps.

## 16. Página pública de privacidade

- **Onde:** `apps/web/public/privacidade.html`, servida em `/privacidade` (reescrita no
  `vercel.json`, antes da reescrita do jogo) e em `/privacidade.html` (o arquivo, que é o que o
  link da Home usa porque existe igual na web e dentro do app).
- **Como se chega:** link "Privacidade" na linha do rodapé da Home — discreto e sem acrescentar
  altura (provado nos 13 viewports da suíte, inclusive 852×300).
- **Responsável:** Tito Viveiros (pessoa física) · contato `titoviveiros@gmail.com` (decisão do
  Tito em 29/09/2026).
- **Estática de propósito:** sem script, sem fonte, estilo ou imagem de terceiro. Uma página de
  privacidade que medisse quem a lê desmentiria o próprio texto.
- **Amarrada aos fatos:** `src/ui/privacidade.test.ts` exige cada item (fornecedor, região, IP
  descartado, coletas automáticas desligadas, a lista do que nunca é enviado, responsável e
  contato) e proíbe recurso externo e promessa de prazo de retenção. Mudou o que o código coleta?
  A página muda **antes**, e o teste aponta o que ficou para trás.

## 17. Prova real no Preview (Fase 4F-B1, 29/09/2026)

Deployment `king-web-git-feat-analytics-v1-tito-viveiros-games.vercel.app` (commit `de90f53`),
aberto **sem** `?trafego=teste`, no navegador embutido com a sessão da Vercel do Tito.

| O que | Resultado |
|---|---|
| Envios | só `POST https://us.i.posthog.com/e/`, todos **HTTP 200**; nenhum `/flags`, `/decide`, `/s/` (gravação) nem script de `us-assets` |
| Recebido pelo PostHog (projeto KING) | `app_open` ×3, `match_started` ×1, `first_match_started` ×1 — **e nada mais** |
| Propriedades (registro bruto) | `environment: "preview"`, `traffic_type: "test"`, `platform: "web"`, `first_open`, `modo/humanos/bots` + técnicas permitidas; `$is_identified: false`, `$process_person_profile: false`; **sem** `$ip`, `$current_url`, `$referrer`, `$pathname`, `$set` |
| Pessoas | `person_mode: "propertyless"`; tela Persons: **0 pessoas** |
| Automáticos, depois de provocar (cliques, rage click, área morta, rolagem, troca de página, erro JS proposital) | **zero** — nenhum `$autocapture`, `$pageview`, `$pageleave`, `$rageclick`, `$dead_click`, `$exception`, `$web_vitals`, `$snapshot`; `elements_chain` vazio |
| Gravações | nenhuma (replay nunca habilitado no projeto; o cliente nem tem o gravador) |
| Fail-open (mesmo commit, chave e host reais, `us.i.posthog.com` bloqueado) | Home em 545 ms, solo jogando, multiplayer 2+2 começando; 11 envios barrados, 0 passaram, 0 erros de página |

Observação do Preview: a Vercel injeta a barra de feedback (`vercel.live/_next-live/feedback`) em
**todo** Preview. Não é do KING, não existe em Production e não fala com o PostHog.
