# KING — prontidão para publicação

O que as lojas exigem, o que o KING **de fato** faz, e o que falta. Levantado do código e de
execuções reais, não de memória.

> ⚠️ **Nada aqui é redação jurídica.** Os trechos marcados como *rascunho* mostram forma e
> conteúdo esperados e precisam de validação antes de virar página pública.

---

## 1. O que o KING coleta, de verdade

> **Atualizado em 28/09/2026.** Até a identidade permanente (setembro/2026) esta seção dizia que
> não havia conta nem banco. **Isso deixou de ser verdade.** O inventário detalhado da identidade
> vive em [KING-IDENTIDADE-PRIVACIDADE.md §3](KING-IDENTIDADE-PRIVACIDADE.md); o que segue é o
> retrato para as lojas.

### 1.1 No aparelho e na sala (como antes)

| Dado | Onde vive | Sai do aparelho? | É PII? |
|---|---|---|---|
| **Apelido** (até 14 caracteres, digitado) | estado da sala no servidor, em memória; **e também `public.players.display_name`** (ver §1.2) | Sim — os outros 3 da mesa veem | **Potencialmente sim**: a pessoa pode digitar o nome real |
| **Avatar** (1 de 8 etiquetas fechadas) | estado da sala + `localStorage` `king:avatar`; preferência em `public.players.avatar_id` | Sim — os outros veem | Não |
| **Código da sala** (4 dígitos) | gerado pelo servidor, em memória | Sim — quem entra digita | Não, mas é **credencial de acesso** |
| **`recoveryToken`** | `localStorage` + memória do servidor | Só entre o dono e o servidor | Não, mas é **segredo** |
| **Progresso do tutorial** | `localStorage` `king:tutorial` | Não | Não |
| **Preferências de áudio** | `localStorage` `king.audio` | Não | Não |
| **Mensagens sociais** | etiqueta de conjunto fechado, efêmera | Sim — a etiqueta, nunca texto livre | Não |
| **Eventos de analytics** | instrumentados (Fase 4F); destino **PostHog** só com `VITE_POSTHOG_*` — **hoje não configurado em Production** | **Hoje não** (adaptador silencioso, SDK nem baixado). Ligado: eventos anônimos de uso, ver [KING-ANALYTICS.md](KING-ANALYTICS.md) | Não — esquema fechado por evento, id **aleatório** por aparelho, sem URL, sem apelido, sem código de sala, sem id de conta/partida; IP descartado no projeto; **GeoIP desligado** (`$geoip_disable`) |
| **Memória local do analytics** | `localStorage` `king.analytics` (primeira abertura, primeiro toque já normalizado, primeira partida, ids das últimas partidas online só para não contar duas vezes) | **Não** — nunca enviada | Não |

### 1.2 Persistido em banco (Supabase, projeto de Production) — NOVO

**Existe conta.** Quem entra no multiplayer online recebe um **convidado anônimo do Supabase Auth**
— uma conta de verdade, sem e-mail e sem senha —, criado só ao entrar online (quem joga apenas
contra os bots não ganha conta nenhuma). O `playerId` da mesa é o `sub` dessa conta, e ele
**sobrevive** à sala.

| Dado | Onde vive | Quem lê | Observação |
|---|---|---|---|
| Conta anônima (`auth.users`) | Supabase Auth | o próprio jogador (sessão) | sem e-mail enquanto não houver vínculo; a sessão fica no `localStorage` do aparelho (`sb-…-auth-token`) |
| Perfil (`public.players`: `id`, `display_name`, `avatar_id`, `created_at`, `updated_at`) | Postgres | o próprio jogador (RLS `auth.uid() = id`) | apelido e avatar já eram visíveis na mesa; agora persistem |
| **Progresso** (`public.progresso`: `player_id`, `xp_total`, `atualizado_em`) | Postgres | só o próprio jogador (RLS) | escrito **só** pelo servidor da partida (papel `king_server`); o cliente não escreve |
| **Ledger de XP** (`public.xp_eventos`: `player_id`, `partida_id`, `motivo`, `posicao`, `xp_delta`, `criado_em`) | Postgres | só o próprio jogador (RLS) | um lançamento por jogador por partida online concluída — revela **posição e horário** de cada partida jogada |
| Partidas creditadas (`king_private.partidas`: `id`, `iniciada_em`, `terminada_em`, `humanos`, `bots`, `versao_regra`, `registrada_em`) | Postgres, schema privado | ninguém pela API | sem identificador de jogador; o vínculo jogador↔partida está no ledger |
| Nível (`public.meu_progresso`) | view | o próprio jogador | **derivado** do `xp_total`, não armazenado |
| **Sequência** (colunas `sequencia_*` em `public.progresso` + `meu_progresso`) — ⏸️ **NÃO APLICADA** | Postgres | só o próprio jogador (RLS) | **derivada** do ledger (dias de São Paulo com XP positivo de partida online), **sem backfill histórico**: só conta o que vier depois do rollout; escrita só pelo gatilho do crédito. Migração `20261001120000_sequencia.sql` preparada, **rollout OFF — Production ainda está sem streak**. Ver `docs/KING-SEQUENCIA.md` |
| Pendências de crédito (outbox) | disco da VPS (`/var/lib/king/progresso-outbox`) | só o servidor | resultado de partida (ids de jogador + posição) guardado **até** o banco confirmar; em operação normal fica vazio |

**Vínculo com Google:** tecnicamente implementado (`linkIdentity` sobre a mesma conta) e validado
em Production em 24/09/2026, mas **OCULTO** em Production (`VITE_KING_GOOGLE_LINK` ausente). Se
for ligado, entra **e-mail** (e nome/foto do perfil Google, conforme os escopos) no Supabase Auth
— e a política de privacidade precisa ser atualizada **antes**.

**Não existe:** login por senha, telefone, endereço, localização, contatos, identificador de
publicidade, câmera, microfone, notificações push, compras.

### 1.3 Lacunas que a publicação precisa fechar

- ⚠️ **Retenção: NÃO DEFINIDA.** Não há prazo nem rotina de expurgo para contas anônimas
  inativas, perfis, progresso ou ledger. Hoje tudo fica indefinidamente.
- ⚠️ **Exclusão de conta: NÃO EXISTE fluxo.** Tecnicamente a cascata está pronta — apagar a conta
  em `auth.users` apaga `players`, `progresso` e `xp_eventos` (verificado no projeto de
  homologação em 27/09/2026); `king_private.partidas` fica, sem dado de jogador. Mas não há botão,
  página nem pedido documentado. Ver §6.
- ⚠️ **Convidado perdido:** a conta anônima vive na sessão do aparelho. Limpar o navegador ou
  trocar de aparelho **perde o acesso** a ela (o progresso fica órfão no banco) — o vínculo
  Google, hoje oculto, é o mecanismo previsto de recuperação.

**Permissões nativas:** só `android.permission.INTERNET`. Nenhuma no iOS. Verificado por
`scripts/validar-mobile.mjs`, que reprova se aparecer qualquer outra.

### O ponto sensível: o apelido

É o único campo de texto livre que viaja. Três decisões:

1. Declarar o apelido como dado pessoal opcional fornecido pela própria pessoa? (**recomendado**)
2. Limitar a exibição à sala em que foi digitado? (**já é o caso hoje**)
3. Avisar na tela que o apelido aparece para as outras pessoas? (**não avisa hoje**; o
   placeholder "Como aparecer na mesa" ajuda, mas não é aviso)

---

## 2. Matriz de prontidão mobile

| Item | Android | iOS | Estado | Blocker? | Depende de | Próxima ação |
|---|---|---|---|---|---|---|
| **Capacitor** | 7.6.8 | 7.6.8 | 🟢 configurado | não | — | — |
| **Projeto nativo** | gerado por `cap add` | gerado por `cap add` | 🟢 geração limpa provada | não | — | ver §3 |
| **Bundle / application id** | `br.com.playkingcards.king` | `br.com.playkingcards.king` | 🟡 **provisório** | **P0 quando publicar** | decisão do titular | **congelar** (ver §4) |
| **Versão (marketing)** | `0.1.0` | `0.1.0` | 🟢 fonte única | não | — | virar `1.0.0` no release |
| **Build number** | `versionCode` | `CURRENT_PROJECT_VERSION` | 🟢 de `KING_BUILD_NUMBER` | não | — | — |
| **Orientação landscape** | `sensorLandscape` | iPhone **e** iPad | 🟢 aplicado e validado | não | — | QA físico |
| **Safe areas / notch / Dynamic Island** | `env(safe-area-inset-*)` | idem + `viewport-fit=cover` | 🟡 só simulado | não | aparelho | QA físico |
| **WSS / TLS** | sem cleartext | ATS padrão | 🟢 medido | não | — | — |
| **CORS de origem nativa** | `http://localhost` | `capacitor://localhost` | 🟢 medido em produção | não | — | — |
| **Compilação** | `assembleDebug` | `xcodebuild` simulador | 🟠 **não executado** | **P0 desta rodada** | escopo `workflow` no token | ver §5 |
| **Ícone do app** | adaptive icon | AppIcon set | 🔴 ausente | **P0** | arte | brief aprovado |
| **Splash** | splash | LaunchScreen | 🔴 ausente | **P0** | arte | brief aprovado |
| **Assinatura** | keystore | certificado + provisioning | 🔴 ausente | **P0** | contas de desenvolvedor | autorização |
| **Conta de desenvolvedor** | Google Play (US$ 25) | Apple (US$ 99/ano) | ⚪ desconhecida | **P0** | titular | decisão |
| **Política de privacidade (URL)** | obrigatória | obrigatória | 🟡 **existe** (`/privacidade`, Fase 4F-B1, ainda só na branch/Preview); falta retenção e fluxo de exclusão | **P0** | retenção + exclusão | §6 |
| **Suporte (URL)** | recomendada | **obrigatória** | 🔴 ausente | **P0** | e-mail | §6 |
| **Termos (URL)** | opcional | opcional | 🔴 ausente | não | titular | §6 |
| **Classificação etária** | questionário | questionário | ⚪ não respondido | **P0** | titular | §6 |
| **Declarações de privacidade da loja** | Data Safety | Privacy Nutrition Labels | ⚪ não preenchido | **P0** | §1 responde — **inclui conta, identificador, progresso e histórico de partidas (§1.2)** | preencher |
| **Exclusão de conta e dados** | exigida (app cria conta) | exigida dentro do app | 🔴 **não existe** | **P0** | fluxo + página | §1.3 e §6 |
| **Retenção de dados** | declarar na política e no Data Safety | declarar | 🟡 **analytics: resolvida com texto factual** — janela de consulta de 12 meses (plano Free), **sem** promessa de exclusão; o PostHog pode guardar por mais tempo ([KING-ANALYTICS.md §15](KING-ANALYTICS.md)) · 🔴 **banco do jogo (Supabase): não definida** | **P0** (banco do jogo) | decisão do titular | §1.3 | §1.3 |
| **Capturas de tela** | phone + tablet | iPhone + iPad | 🔴 ausentes | **P0** | arte | depois dos avatares |
| **Analytics** | PostHog anônimo **conectado só no Preview** (4F-B1); **desligado** em Production | idem (mesmo código; `VITE_KING_AMBIENTE=production` no build de loja) | 🟡 Preview validado, Production na 4F-B2 | **P0 antes de ligar em Production**: `/privacidade` no ar em Production | 4F-B2 | [KING-ANALYTICS.md §13](KING-ANALYTICS.md) |
| **Error monitoring** | ausente | ausente | 🟡 recomendado | P1 | decisão | §7 |
| **Reconnect** | testado no navegador | testado no navegador | 🟡 lacuna de lifecycle | P1 | aparelho | §8 |
| **QA físico** | — | — | 🔴 não feito | P1 | aparelho | — |
| **Tutorial no app** | mesma persistência | mesma persistência | 🟡 não verificado no WebView | P1 | aparelho | §9 |
| **Listagem da loja** (descrição, palavras-chave) | — | — | 🔴 ausente | **P0** | titular | — |

---

## 3. `android/` e `ios/`: gerar ou versionar?

**Estado atual:** fora do git; gerados por `npx cap add` e configurados por
`scripts/preparar-mobile.mjs`, com `scripts/validar-mobile.mjs` como portão.

**Prova executada** (nesta máquina, ciclo completo do zero):

```
rm -rf android ios → cap add → cap sync → validar  ⇒ REPROVA (5 falhas)
                              → preparar → validar ⇒ APROVA (17/17)
```

Ou seja: a geração limpa funciona, e o portão não é decorativo — reprova um projeto recém-gerado
justamente porque ele ainda vem em retrato e com a versão errada.

### Comparação

| Critério | A. Gerar a cada CI (**atual**) | B. Versionar os nativos |
|---|---|---|
| Reprodutibilidade do código | 🟢 sai do config, sempre igual | 🟢 exato no git |
| Reprodutibilidade de **dependências** | 🔴 `Podfile.lock` não versionado — pods podem variar entre execuções | 🟢 lock fixo |
| Repositório | 🟢 limpo | 🟡 +500 arquivos, inclui `gradle-wrapper.jar` |
| Drift config↔nativo | 🟢 impossível | 🟡 possível se alguém editar só um lado |
| Ícone e splash | 🔴 **não têm onde morar** | 🟢 moram no projeto |
| Assinatura | 🔴 idem | 🟢 idem |
| Plugins nativos futuros | 🟡 script precisa crescer | 🟢 natural |
| Customização nativa | 🔴 tudo vira regex no script | 🟢 edição direta |
| Prática do Capacitor | 🟡 minoritária | 🟢 recomendada na doc oficial |
| Tempo de CI | 🟡 `cap add` + `pod install` toda vez | 🟢 só `pod install` |

### Recomendação — **mudar para B, mas não agora**

A estratégia A é adequada **enquanto a única customização nativa for orientação e versão** — que
é exatamente o caso hoje, e está provado acima.

Ela deixa de ser adequada no momento em que entrarem **ícone, splash e assinatura**. Esses três
não são texto que um regex ajusta: são conjuntos de arquivos e configurações que vivem dentro do
projeto nativo. Manter A depois disso significaria transformar `preparar-mobile.mjs` num
mini-Capacitor — e é assim que scripts de build viram a parte mais frágil de um projeto.

Há também um furo de reprodutibilidade em A que vale registrar: **`Podfile.lock` não é
versionado**, então duas execuções de CI em dias diferentes podem resolver versões diferentes de
pods. Hoje só existe o pod do próprio Capacitor, então o risco é baixo — mas ele é real e cresce
com cada plugin.

**Momento de virar:** junto da primeira entrega de ícone/splash. Aí `android/` e `ios/` saem do
`.gitignore`, entram no repositório uma vez, e `preparar-mobile.mjs` passa a ser rede de segurança
(valida que a config continua certa) em vez de fonte única.

> Esta mudança **não foi feita**. É mudança arquitetural relevante e aguarda decisão.

---

## 4. Bundle identifier

**Valor atual:** `br.com.playkingcards.king` — **escolhido por mim** ao criar
`capacitor.config.ts`, derivado do domínio real `playkingcards.com.br`. É um valor razoável, mas
**não foi decidido por você**, e por isso está marcado como provisório.

**Onde aparece** (três lugares, mantidos em sincronia e conferidos pelo validador):

| Arquivo | Chave |
|---|---|
| `apps/web/capacitor.config.ts` | `appId` |
| `apps/web/android/app/build.gradle` | `applicationId` |
| `apps/web/ios/App/App.xcodeproj/project.pbxproj` | `PRODUCT_BUNDLE_IDENTIFIER` |

**Impacto de mudar depois:** enquanto nada foi enviado às lojas, mudar é trocar uma linha e
regenerar — custo zero. **Depois do primeiro envio, é irreversível:** o identificador é a
identidade do app na Apple e no Google. Mudar significa app novo, ficha nova, avaliações
zeradas, e usuários instalados que nunca mais recebem atualização.

**Quando congelar:** antes de criar o app no App Store Connect ou no Google Play Console — que é
também quando o titular jurídico precisa existir. Até lá, o valor atual serve para compilar.

**Não precisa ser congelado para a prova de compilação desta rodada.**

---

## 5. Versão e build number

Duas coisas diferentes, mantidas separadas de propósito:

| | O que é | Fonte | Onde chega |
|---|---|---|---|
| **VERSION** | versão visível (`1.0.0`) | `version` do `package.json` da **raiz** | `versionName` (Android), `MARKETING_VERSION` (iOS) |
| **BUILD NUMBER** | inteiro que só cresce, exigido a cada envio | `KING_BUILD_NUMBER` (no CI, `github.run_number`) | `versionCode` (Android), `CURRENT_PROJECT_VERSION` (iOS) |

`scripts/preparar-mobile.mjs` é a **fonte única**: lê a versão da raiz e escreve nos dois nativos.
`scripts/validar-mobile.mjs` reprova se divergirem.

**Isto corrigiu um defeito real:** o `package.json` dizia `0.1.0` enquanto `npx cap add` tinha
carimbado `1.0` nos dois projetos nativos. Ninguém repara nisso até uma loja recusar um envio.

**Hoje:** `0.1.0`. **No release:** subir a raiz para `1.0.0` — um lugar só.

---

## 6. Páginas públicas e decisões do proprietário

Domínio já existente: `playkingcards.com.br`.

| Página | Exigida por | Situação | URL sugerida |
|---|---|---|---|
| **Política de Privacidade** | App Store **e** Google Play | 🟡 **existe** em `/privacidade` (Fase 4F-B1): responsável, contato, dados do jogo e medição anônima. **Ainda não diz retenção nem fluxo de exclusão** — e só vai a Production junto da 4F-B2 | `/privacidade` |
| **Suporte** | App Store (campo obrigatório) | 🔴 não existe | `/suporte` |
| **Termos de Uso** | recomendada | 🔴 não existe | `/termos` |
| **Exclusão de conta/dados** | Google Play (apps que criam conta), e a App Store pede exclusão dentro do app | 🔴 **não existe — e passou a ser exigida**: o multiplayer cria conta (convidado anônimo, §1.2) | `/excluir-conta` *(sugestão)* |

As três primeiras precisam responder HTTP 200, sem login, **antes** da submissão.

### Estrutura da Política de Privacidade

1. **Quem somos e como falar conosco** — responsável e e-mail. *(falta)*
2. **O que coletamos** — as tabelas da §1.1 e §1.2, em linguagem simples.
3. **Por que** — apelido e avatar existem para os outros jogadores saberem quem é quem; o código
   da sala existe para entrar na partida certa; a conta anônima mantém a mesma identidade entre
   partidas; o ledger e o progresso existem para o XP e o nível. Nada é usado para publicidade.
4. **O que NÃO coletamos** — a lista da §1.2. Continua a seção mais curta e a mais tranquilizadora.
5. **Onde ficam e por quanto tempo** — sala em memória no servidor, apagada ao fim da partida;
   preferências **no aparelho**; **conta, perfil, progresso e ledger no banco (Supabase)**. O
   "por quanto tempo" do banco **ainda não está definido** (§1.3) — a política não pode ser
   publicada sem essa resposta.
6. **Com quem compartilhamos** — nenhum terceiro para fins próprios; o **Supabase** é o operador
   que hospeda o banco e a autenticação, e precisa ser nomeado como tal. **A medição de uso já
   está instrumentada (Fase 4F) com o PostHog como operador** — anônima, id aleatório por
   aparelho, sem IP guardado; o conteúdo mínimo está em [KING-ANALYTICS.md §15](KING-ANALYTICS.md).
   Ela **só pode ser ligada em Production depois** desta seção nomear o PostHog e a região. *(Captura
   de erro ou login Google também mudam esta seção, e a política precisa ser republicada ANTES.)*
7. **Crianças** — depende da classificação etária.
8. **Direitos do titular (LGPD)** — **há conta e dado persistido**: acesso, correção e exclusão
   passam a ser pedidos reais. Exige o fluxo de exclusão da §6 e um canal de contato.
9. **Alterações** — data da última atualização.

> *Rascunho de tom, não de texto final:* "O KING não pede cadastro, não pede e-mail nem senha.
> Quando você joga online, o jogo cria para você uma conta anônima — é ela que guarda o seu XP e o
> seu nível entre partidas. Seu apelido e seu avatar aparecem para as pessoas da sua mesa."
>
> *(O rascunho anterior dizia que o KING "não sabe quem você é" e que tudo durava "enquanto a
> partida durar" — frases que o progresso persistente tornou falsas.)*

### Página de Suporte — conteúdo mínimo

e-mail que alguém leia *(falta)* · como jogar (apontar para o APRENDA KING) · problemas comuns
(não entro na sala, caí no meio da partida, não tem som) · como relatar erro · link para a
privacidade.

### ⏸️ Decisões que dependem de você

| # | Decisão | O que trava |
|---|---|---|
| 1 | ✅ **E-mail de contato:** `titoviveiros@gmail.com` *(decidido em 29/09/2026; já na página de privacidade)* | suporte e ficha da loja ainda podem usar outro |
| 2 | ✅ **Responsável:** Tito Viveiros, pessoa física *(29/09/2026)* | Google Play exige conta verificada; migrar para CNPJ é trocar uma linha da página |
| 3 | **Classificação etária** | KING é jogo de cartas sem aposta, sem dinheiro e **sem chat livre** — perfil de classificação baixa, mas o questionário é por loja |
| 4 | **Bundle identifier definitivo** | ver §4 |
| 5 | **Contas de desenvolvedor** | assinatura e envio |

---

## 7. Analytics e error monitoring

**Analytics** — **instrumentado na Fase 4F com PostHog, anônimo, e desligado em Production** até a
Fase 4F-B. Documento próprio: [KING-ANALYTICS.md](KING-ANALYTICS.md) (eventos, propriedades, o que
não é coletado, retenção, aquisição, dashboards, tráfego de teste, kill switch).

A regra de sempre continua: `track()` não devolve promessa, envolve tudo em `try/catch`, e sem
`VITE_POSTHOG_KEY` + `VITE_POSTHOG_HOST` o destino é o silêncio — **o SDK nem é baixado**. Com as
duas, o SDK chega sob demanda, fora do pacote inicial. PostHog lento, fora do ar ou barrado por
adblock não muda nada no jogo (provado no e2e). No build Capacitor o comportamento é o mesmo; a
plataforma vem do runtime nativo e o build de loja precisa de `VITE_KING_AMBIENTE=production`.
Fora de escopo por decisão: Adjust, AppsFlyer, Firebase Analytics, IDFA/ATT, Advertising ID.

### Error monitoring — comparação (não instalar agora)

Três opções compatíveis com Web + Capacitor + iOS + Android, volume inicial baixo:

| | **Sentry** | **GlitchTip** (auto-hospedado) | **Firebase Crashlytics** |
|---|---|---|---|
| Web + Capacitor | 🟢 SDK JS cobre os dois | 🟢 usa o SDK do Sentry | 🟡 exige plugin nativo por plataforma |
| Crash nativo (fora do WebView) | 🟢 com plugin | 🔴 só JS | 🟢 é a especialidade |
| Source maps | 🟢 excelente | 🟢 mesmo formato | 🟡 limitado para JS |
| Custo inicial | 🟢 free tier ~5k eventos/mês | 🟢 software livre; paga-se o servidor | 🟢 gratuito |
| Privacidade / onde ficam os dados | 🟡 servidor do fornecedor (EU/US) | 🟢 **na VPS que já existe** | 🔴 Google; puxa dependências do Firebase |
| Impacto na política de privacidade | declara terceiro | 🟢 nenhum terceiro | declara Google |
| Esforço | 🟢 baixo | 🟡 médio (subir e manter) | 🟡 médio (config nativa) |
| Peso no bundle | 🟡 ~25 kB gz | 🟡 mesmo | 🟢 nativo |

**Recomendação: GlitchTip auto-hospedado na VPS que já existe.**

O KING é quase inteiramente JavaScript dentro de um WebView — crash nativo puro é o caso raro, e
é justamente onde o Crashlytics ganharia. Em compensação, GlitchTip usa o protocolo do Sentry
(mesmo SDK, mesmos source maps, migração trivial se um dia quisermos o serviço pago), roda na VPS
que já está paga e monitorada, e **não acrescenta nenhum terceiro à política de privacidade** —
que, num jogo que hoje não compartilha nada com ninguém, é uma vantagem de produto, não só
técnica.

Se a operação de mais um serviço na VPS pesar, a segunda escolha é **Sentry no plano gratuito**.

**Não instalar antes de:** decidir, e atualizar a política de privacidade — a captura precisa ser
declarada **antes** do primeiro evento.

---

## 8. Lifecycle, background e reconnect

**Comportamento esperado no mobile:**

```
app → background        WebView suspensa; timers estrangulados; o WebSocket pode morrer
app → foreground        o cliente precisa PERCEBER e agir
                        ↓
                        SDK do Colyseus reconecta sozinho (queda transitória)
                        ou o recoveryToken devolve o MESMO assento
```

**O que existe hoje:** `aoCair`/`aoVoltar` ligados a `onDrop`/`onReconnect` do SDK, mais
`recoveryToken` e o botão "Voltar para a minha sala". Validado no navegador contra a VPS de
produção: a queda aparece como *ausente* + selo **Assistência** para os outros, e o retorno
devolve o mesmo assento com o mesmo avatar e a mão em curso.

**A lacuna:** não existe **nenhum tratamento de `visibilitychange`** no código
(`grep` em `apps/web/src`: zero ocorrências). No navegador isso não incomoda, porque a aba
raramente é congelada. No iOS, a WKWebView é suspensa de verdade: se o socket morrer enquanto o
app está em segundo plano, o cliente pode voltar achando que ainda está conectado até uma jogada
falhar.

**Proposta (não implementada):** ouvir `document.visibilitychange` e, ao voltar a `visible`,
forçar uma verificação da sessão. Isso **não exige plugin nativo** — `visibilitychange` funciona
em WKWebView e no WebView do Android —, então preserva integralmente a arquitetura atual e não
acrescenta dependência.

**Por que não foi implementado agora:** o comportamento exato depende de quanto tempo o sistema
leva para derrubar o socket e de o SDK notar sozinho — coisas que **só um aparelho físico
responde**. Implementar às cegas correria o risco de mascarar o problema real ou de forçar
reconexões desnecessárias.

> 📱 **APARELHO FÍSICO NECESSÁRIO** para: confirmar a lacuna, medir o tempo até a queda e validar
> a correção. iPhone e Android, com o app em segundo plano por 30 s, 2 min e 10 min.

---

## 9. Tutorial, áudio e haptics no app

| | Situação | Observação |
|---|---|---|
| **Tutorial NÃO abre sozinho** | 🟢 coberto por Playwright | a Home é a primeira tela em qualquer visita; o tutorial só abre pelo botão |
| **Não entra em loop** | 🟢 coberto por Playwright | nada o abre sem toque; o progresso salvo serve só para retomar |
| **Acessível manualmente** | 🟢 "Rever como se joga" na Home | — |
| **WebView landscape** | 🟡 orientação travada nativamente; layout validado em 6 viewports | falta aparelho |
| **AudioContext** | 🟡 desbloqueado no 1º gesto (`audio.unlock()` no "Jogar agora") | é o padrão exigido por iOS; já implementado |
| **Autoplay** | 🟢 nenhum som toca antes de um gesto | — |
| **Áudio em background** | 🟡 não verificado | esperado: suspende junto com a WebView |
| **Haptics** | 🔴 **`navigator.vibrate` não existe no iOS** | funciona no Android; no iPhone os padrões táteis são silenciosamente ignorados |

**Sobre haptics no iOS:** é limitação da plataforma, não defeito do KING — `navigator.vibrate`
nunca foi implementado no Safari/WKWebView. Corrigir exigiria `@capacitor/haptics` (plugin
nativo). **Não instalado**: o jogo é inteiramente jogável sem tátil, nenhuma informação depende
dele (a regra de acessibilidade do projeto já garante cor + texto + som), e a decisão de
acrescentar plugin nativo é sua. Registrado como P2.

---

## 10. Assets que ainda bloqueiam o release

Nenhum foi produzido. Todos dependem da arte dos avatares
([brief](KING-AVATARS-ART-BRIEF.md), [pacote Sapo+Panda](KING-AVATARS-PACOTE-SAPO-PANDA.md)).

### Android

| Asset | Dimensão | Formato | Uso | Obrigatório |
|---|---|---|---|---|
| Ícone adaptativo — foreground | 432×432 (safe 264×264 central) | PNG-32 ou vetor | ícone do launcher | **sim** |
| Ícone adaptativo — background | 432×432 | PNG ou cor sólida | idem | **sim** |
| Ícone legado | 48/72/96/144/192 (mdpi→xxxhdpi) | PNG-32 | Android < 8 | sim |
| Ícone da Play Store | 512×512 | PNG-32, sem transparência | ficha da loja | **sim** |
| Splash | 2732×2732 (centralizado) | PNG-32 | abertura | sim |
| Feature graphic | 1024×500 | PNG/JPG | topo da ficha | **sim** |
| Capturas — telefone | mín. 1080×1920 ou landscape equivalente, 2–8 | PNG/JPG | ficha | **sim** |
| Capturas — tablet 7"/10" | conforme loja | PNG/JPG | ficha | recomendado |

### iOS

| Asset | Dimensão | Formato | Uso | Obrigatório |
|---|---|---|---|---|
| AppIcon | 1024×1024 (Xcode gera as demais) | PNG-24 **sem alpha** | ícone + App Store | **sim** |
| LaunchScreen | storyboard + imagem centralizada | PNG-32 | abertura | **sim** |
| Capturas — iPhone 6.7" | 1290×2796 (ou 2796×1290 landscape) | PNG/JPG | ficha | **sim** |
| Capturas — iPhone 6.5" | 1242×2688 / 2688×1242 | PNG/JPG | ficha | conforme loja |
| Capturas — iPad 12.9" | 2048×2732 / 2732×2048 | PNG/JPG | ficha | se publicar para iPad |

### Comum

| Asset | Situação |
|---|---|
| Wordmark KING para splash e ficha | existe como texto/CSS; falta versão em imagem |
| Coroa da marca | existe em SVG (`Crown.tsx`) — **serve de base para ícone** |
| 8 avatares finais | 🔴 em produção fora desta rodada |

> A coroa já vetorizada é o único asset de marca que existe hoje. Combinada com Sapo + Leão
> (recomendação de marketing do brief), é o caminho mais curto para ícone e splash.

---

## 11. QA em aparelho físico — obrigatório e permanente

**Emulação de viewport não é suficiente. Isto foi provado na prática.**

Em 24/08/2026 a suíte estava verde em sete viewports — 115 testes de layout, colisões medidas por
`DOMRect`, seis larguras de celular — e um teste em **iPhone real, em paisagem**, encontrou cinco
defeitos que nenhum deles pegava:

| Encontrado no aparelho | Por que a emulação não pegou |
|---|---|
| Home cortada em cima e embaixo | o painel só estoura com o formulário aberto, e nenhum teste o abria em altura baixa |
| "ESTOU PRONTO" cortado no Lobby | o Lobby é tela de multiplayer — **não havia servidor no e2e**, então era inalcançável |
| Mão do jogador cortada | `position:fixed; inset:0` mede a viewport de LAYOUT; **no Chromium headless não existe barra de navegador**, então a de layout e a útil são idênticas |
| Botão social espremido | idem: só existe em tela de multiplayer |
| Tutorial travando no meio | consequência do anterior — a carta que ele pede ficava sob a barra |

**O que mudou por causa disso** (e fica como regra permanente):

1. três viewports de **altura compacta** entraram na matriz — 852×330, 740×320 e 852×300;
2. o Playwright passou a subir **também o servidor Colyseus**, para Lobby e Mesa multiplayer
   deixarem de ser pontos cegos;
3. o percurso do tutorial passou a exigir que cada alvo esteja **inteiro no viewport e não
   coberto** antes de clicar — o `click()` do Playwright rola o elemento para dentro da tela e
   por isso passava onde um dedo não alcançaria.

**O que continua exigindo aparelho:** barra do navegador de verdade, gesto de home, teclado
virtual, Dynamic Island, haptics, e o ciclo background→foreground do WebSocket.

---

## 12. Vulnerabilidades de dependência

**12 alertas, nenhum explorável no KING.** Todos vivem em ferramenta de desenvolvimento (Vitest,
Vite/esbuild) ou em submódulos do Colyseus (`@colyseus/auth`, `@colyseus/playground`) que são
carregados mas **não montados** — medido em produção, local e na VPS: `/playground`, `/auth` e
`/auth/providers` respondem **404**.

As correções oferecidas pelo `npm audit` são todas **major**, e uma (`colyseus@0.15`) é um
**downgrade** que quebraria o servidor. Nenhuma foi aplicada. Nenhuma é blocker de publicação.
Débito de manutenção agendável, não urgência.
