# KING — Release Candidate mobile (Fase 8, 23/10/2026)

O que existe, o que falta e em que ordem, para o KING virar app publicável na Play e na App Store.
**Esta fase não publica nada** — nem lojas, nem Production. Ela tira de cima da mesa os riscos
técnicos que só apareceriam na revisão das lojas.

Decisões de produto registradas nesta fase:

- **iOS: o primeiro envio é SÓ IPHONE**, em paisagem. Suporte a iPad (retrato, multitarefa,
  janelas redimensionáveis) é evolução posterior, não bloqueio. **`UIRequiresFullScreen` não é a
  saída** (depreciado no iPadOS 26).
- Rota mobile continua sendo **Capacitor** (o mesmo `dist/` da web dentro do app).

**Decisões de identidade e backup — CONGELADAS (23/10/2026, Tito):**

- **A — Backup do Android:** a sessão do convidado NÃO participa de backup, restauração nem
  transferência entre aparelhos (copiar a sessão clonaria a identidade). Implementado e validado no
  portão (seção 2). Trocar de aparelho recupera o progresso pela conta vinculada (Google/Apple).
- **B — iCloud / backup do iPhone:** a MESMA política. Nesta fase: política e arquitetura (seção 3);
  o código nativo é gate do RC (depende de Mac/Xcode).
- **C — Dois fluxos distintos:** "Vincular conta" (o convidado atual ganha Google/Apple pelo
  `linkIdentity`, mesmo `auth.users.id`) e "Já tenho uma conta" (recuperação EXPLÍCITA de uma
  identidade existente — nunca `linkIdentity` sobre o convidado novo). Arquitetura na seção 19;
  a implementação é **P0 da Fase 9**.

---

## 1. Estado real

| Item | Estado |
|---|---|
| Capacitor | **8.5.3** (core, cli, android, ios). Era 7.6.8 — subiu porque a Play exige API 36 (seção 2) |
| Plugins nativos | **nenhum** (nem `@capacitor/app` ainda) |
| `android/` e `ios/` | gerados por `npx cap add`, **fora do git**; a configuração vive como código em `scripts/preparar-mobile.mjs` e o portão é `scripts/validar-mobile.mjs` (**27 verificações**) |
| Identificador | `br.com.playkingcards.king` (Android e iOS) |
| Versão | `0.1.0` (do `package.json` da raiz); build `1` (`KING_BUILD_NUMBER`) |
| Build Android de teste | **verde** (`assembleDebug`, chave de depuração, APK de ~5 MB) |
| Build iOS | **impossível aqui** — exige macOS com Xcode 26 |

Gerar e conferir os projetos nativos:

```bash
VITE_KING_SERVER_URL=wss://server.playkingcards.com.br npm run mobile:sync
```

Compilar o Android nesta máquina (o app Claude virtualiza a AppData; o SDK precisa vir por
`ANDROID_HOME`, e o JDK 21 portátil só no comando — o Java 23 do sistema fica intacto):

```bash
cd apps/web/android && JAVA_HOME=C:/Users/titov/jdks/jdk-21.0.12.1+1 ANDROID_HOME="$LOCALAPPDATA/Android/Sdk" ./gradlew assembleDebug --no-daemon
```

O APK de teste NÃO tem `VITE_SUPABASE_*` nem `VITE_POSTHOG_*`: serve para provar compilação, não
para QA de identidade. O build de QA tem de usar a mesma configuração pública da Vercel.

## 2. Android

| Item | Estado | Classe |
|---|---|---|
| `targetSdk` / `compileSdk` | **36** | ✅ (era 35: **P0** — a Play exige 36 para app novo desde 31/08/2026) |
| `minSdk` | 24 (Android 7.0) | ✅ |
| AGP / Gradle | 8.13.0 / 8.14.3 | ✅ |
| Permissões | só `INTERNET` | ✅ |
| Texto claro | proibido (sem `usesCleartextTraffic`, sem `networkSecurityConfig`) | ✅ |
| Backup / transferência entre aparelhos | `app_webview/` (onde mora a sessão do convidado) **excluído** do backup na nuvem e da transferência (`dataExtractionRules` + `fullBackupContent`), validado no portão — restaurar a sessão noutro aparelho CLONARIA a identidade e o Supabase derrubaria as duas (red team) | ✅ (decisão A, congelada) |
| Orientação | `sensorLandscape`; **o Android 16 ignora a trava em tela grande (tablet)** — o `RotateGate` (aviso de girar) cobre o retrato | P1 |
| Margens edge-to-edge | o Capacitor 8 tirou `adjustMarginsForEdgeToEdge`; o KING usa `env(safe-area-inset-*)` — **conferir em aparelho com recorte** | gate de QA |
| Assinatura de release | **não existe** (upload key + Play App Signing) | **P0** (ação do Tito) |
| Ícone adaptativo / splash | **padrão do Capacitor** | **P0** (depende da arte) |
| App Links | sem `intent-filter` (seção 9) | P1 |
| `versionCode` | `1` fixo; precisa crescer a cada envio (`KING_BUILD_NUMBER` no CI) | P1 |
| Prova de compilação em CI | `.github/workflows/mobile.yml` existe só no commit local `d3e1ffb`: o token do git não tem escopo `workflow` | P1 |

## 3. iOS

| Item | Estado | Classe |
|---|---|---|
| Dispositivos | **só iPhone** (`TARGETED_DEVICE_FAMILY = 1`), validado no portão | ✅ (decisão) |
| Deployment target | iOS 15.0 (mínimo do Capacitor 8) | ✅ |
| Gerenciador de pacotes | Swift Package Manager (padrão do Capacitor 8) | ✅ |
| ATS | padrão da Apple, sem exceções | ✅ |
| Exportação | `ITSAppUsesNonExemptEncryption = false` (só HTTPS/TLS do sistema) | ✅ |
| `UIRequiresFullScreen` | ausente, e o portão reprova se aparecer | ✅ (decisão) |
| Equipe / assinatura | sem `DEVELOPMENT_TEAM` | **P0** (Apple Developer) |
| Sign in with Apple | sem entitlement | **P0** se o Google for oferecido no iOS (seção 6) |
| Universal Links | sem entitlement `associated-domains` | P1 |
| Ícone (1024×1024) / tela de abertura | padrão | **P0** (arte) |
| Manifesto de privacidade / App Privacy | não preenchidos | P1 (fase de compliance) |
| Região de desenvolvimento | `en` (o app é pt-BR) | P2 |
| Backup do iCloud / Início Rápido | **decisão B: a sessão do convidado não vai para outro aparelho.** Hoje o iCloud e o Início Rápido levam os dados do WKWebView. Caminho previsto: a sessão do Supabase sai do localStorage do WebView para o **Keychain com acesso `…ThisDeviceOnly`** (item que nunca migra por backup nem restauração) — o mesmo passo resolve o armazenamento durável (seção 8); alternativa mínima: marcar a pasta de dados do WebKit com `isExcludedFromBackup` no arranque | **gate do RC** (código nativo, Mac/Xcode) |

**Depende de Mac + Apple Developer** (não dá para fazer daqui): compilar no Xcode 26, escolher a
equipe, ligar as capacidades (Sign in with Apple, Associated Domains), assinar, subir ao App Store
Connect, TestFlight.

## 4. Autenticação hoje (web)

```
convidado (signInAnonymously, só ao entrar online)
  → playerId = auth.users.id = sub do JWT
  → servidor confere a assinatura pelo JWKS (ES256/RS256) — nunca confia no cliente
  → Google: linkIdentity (OAuth + PKCE) sobre o MESMO convidado → volta em /?conta=google
```

Regras que não mudam: guest-first; o Google **vincula** (nunca `signInWithOAuth`); nenhuma identidade
paralela; `auth.users.id` canônico; `public.players` 1:1; **o Google segue desligado em Production**
(`VITE_KING_GOOGLE_LINK` ausente) até gate explícito.

## 5. Google no app

**O fluxo da web não serve dentro do app**: o Google recusa OAuth em WebView embutido
(`disallowed_useragent`), e a origem do app (`https://localhost` no Android, `capacitor://localhost`
no iOS) não é endereço de retorno.

**Arquitetura do app (implementada no JS, sem o plugin ainda):**

```
tela nativa do sistema (plugin)  →  ID token com nonce = SHA-256(bruto)
  → linkIdentity({ provider, token, nonce: bruto })   // auth-js 2.112: POST /token?grant_type=id_token
                                                       //   com o JWT do convidado e link_identity: true
  → o MESMO usuário ganha a identidade
```

- Código: `apps/web/src/auth/credencialNativa.ts` (ponte do plugin, nonce, detecção do app) e
  `conta.ts` (`vincularComCredencial`, `vincularNoApp`). No app, sem plugin registrado, a conta nem
  aparece na Home; o fluxo web retorna "indisponível".
- **Nunca `signInWithIdToken`** — os exemplos dos fornecedores usam, e isso criaria OUTRO usuário. A
  porta do KING nem tem esse método.
- Plugin recomendado: **`@capgo/capacitor-social-login`** (Google e Apple nativos, devolve ID token,
  mesmo esquema de nonce). Conferir a versão compatível com o Capacitor 8 na instalação.

**Configuração externa necessária (o Tito faz; nenhum segredo vem para o chat):**

1. Google Cloud > OAuth: **cliente Web** (é o `serverClientId` do Android e o do Supabase), **cliente
   Android** (pacote `br.com.playkingcards.king` + SHA-1 do certificado — o de depuração para teste e
   o da Play App Signing para produção) e **cliente iOS** (bundle id; o *reversed client id* vira
   esquema de URL no `Info.plist`).
2. Tela de consentimento: hoje em **Testing com 1 usuário** — publicar antes do rollout.
3. Supabase > Auth > Google: **Client IDs autorizados** = cliente Web + cliente iOS (separados por
   vírgula). Vínculo manual já está ligado (validado em Production na microfase 3B).
4. Só então: instalar o plugin, registrar a fonte (`registrarFonteNativa`) e testar em aparelho.

Erros tratados (com teste): cancelado; conta Google/Apple **já ligada a outro jogador**
(`identity_already_exists` → nada se funde, o convidado segue — e se a identidade já é DESTE jogador,
por toque duplo, vira sucesso); provedor falhou; token recusado pelo Supabase; **token em cache com o
nonce de outro pedido** (Google Sign-In do iOS: nem vai ao Supabase — `esquecer` e uma nova tentativa);
sem convidado (a tela do Google nem abre); já vinculado; usuário trocado; identidade que não aparece.
Logout: o KING não tem "sair" de conta — o convidado é o jogador; desvincular fica para a fase da
exclusão de conta.

**Dados pessoais:** o vínculo grava no Supabase o e-mail da identidade (e a identidade guarda nome e
foto). App Privacy, Data safety e a Política de Privacidade precisam declarar isso, e a exclusão de
conta precisa apagar. Os avisos da tela ainda falam "Google" — quando a Apple entrar, ficam neutros.

**Caminho de volta = decisão C:** depois de reinstalar ou trocar de aparelho, ligar o mesmo
Google/Apple hoje responde "já ligada a outro jogador". A saída decidida é o fluxo separado
"Já tenho uma conta" (seção 19), P0 da Fase 9 — inclusive porque a revisão da Apple reutiliza o
próprio Apple ID entre envios.

## 6. Sign in with Apple

Oferecer login de terceiro (Google) no iOS obriga a oferecer **Sign in with Apple** (diretriz 4.8).
A mesma camada atende: `vincularNoApp("apple", …)` → `linkIdentity({ provider: "apple", … })`. O
servidor já reconhece `apple` como provedor.

Configuração externa (Apple Developer): App ID `br.com.playkingcards.king` com a capacidade
**Sign in with Apple**; no Supabase > Auth > Apple, **Client IDs** = o bundle id (o fluxo nativo não
precisa de Services ID — esse é só da web). Para a **exclusão de conta**, a Apple exige **revogar o
token** do usuário — isso pede a chave privada do Sign in with Apple no SERVIDOR (seção 13).

**Pedir o escopo `email` da Apple** (o relay privado serve): sem e-mail verificado, o Supabase entra
no ramo de confirmação de e-mail e o vínculo falha ou fica pendente, com o usuário ainda
`is_anonymous`. Por isso, um futuro expurgo de convidados abandonados tem de filtrar por "sem
identidades", nunca por `is_anonymous`. O nome só vem no primeiro login — o KING não usa.

**No código:** no iPhone a conta fica escondida (`contaConfigurada` = `null`) até a Home ter o botão
da Apple — com teste. A lógica de vínculo Apple está pronta; a interface não.

## 7. Arquitetura de vínculo

Uma camada, dois provedores, a mesma política (`vincularComCredencial`):

1. exige a sessão do convidado (nunca cria uma);
2. se o provedor já está vinculado, responde sem abrir tela nenhuma;
3. `linkIdentity` com o ID token;
4. o usuário que volta tem de ser o mesmo; senão, `troca-de-usuario`;
5. só a identidade em `getUserIdentities` prova o vínculo;
6. nenhum token é guardado.

## 8. Convidado preservado

Provado em teste (`vinculoNativo.test.ts`, `conta.test.ts`, `tokenConvidado.test.ts`): nenhum caminho
de vínculo chama `signInAnonymously`, `signInWithOAuth`, `signInWithIdToken` ou cria sessão nova; o
`userId` antes e depois é o mesmo; conta já ligada a outro jogador não troca o jogador de dono.

**Corrigido nesta fase (red team, P0, defeito anterior):** quando a renovação da sessão falhava (rede
ou 5xx — os erros que o SDK trata como passageiros; o 429 NÃO é um deles, ver o P1 dos limites de
taxa abaixo), o SDK mantinha a sessão guardada e respondia `session: null` com `error` — e o
`token()` criava OUTRO convidado por cima. No celular, voltar do segundo plano com o token vencido e
a rede piscando bastava. Agora erro de renovação = "sem token agora", nunca convidado novo.

Riscos que sobram (sem código nesta fase):

- **Armazenamento do WebView é descartável** para o sistema (a própria doc do Capacitor manda tratá-lo
  como transitório). Se o sistema limpar, nasce um convidado novo. Saída: guardar a sessão do
  Supabase num armazenamento durável do app (Preferences/Keychain) — dependência nova. **P1.**
- **429 definitivo na renovação** apaga a sessão no próprio SDK: conferir os limites do Supabase
  (30 logins anônimos por hora por IP; CGNAT de operadora junta muita gente num IP) e subir antes do
  lançamento. **P1.**
- **Usuário trocado:** a trava detecta e avisa, mas o SDK já gravou a outra sessão antes de
  devolver; restaurar a anterior com `setSession` fica para quando houver evidência de que o servidor
  faça isso (hoje é teórico). **P2.**

## 9. Convite por link no app

Hoje: `https://playkingcards.com.br/?sala=1234` abre a Home com o código no campo; **nunca entra
sozinho**. O link criado no app já sai com a origem pública (nunca `localhost`).

Para o app abrir o link:

| Peça | Estado |
|---|---|
| Leitor do endereço que abre o app | **pronto**: `conviteDoLinkDoApp(url)` — só `https://playkingcards.com.br`; recusa outro domínio, domínio parecido, http, esquema próprio, usuário embutido (com teste) |
| Receber o endereço | falta `@capacitor/app` (`appUrlOpen` com o app aberto, `getLaunchUrl` no arranque) |
| Comportamento | arranque a frio = igual à web; app aberto na Home = preenche o painel; **no meio de uma partida = aviso discreto, nunca troca de tela nem entra** |
| Android App Links | `intent-filter` `autoVerify` com `android:scheme="https"`, `android:host="playkingcards.com.br"` e **`android:path="/"` exato** (sem isso, `/privacidade` e `/excluir-conta` abririam o app) + `/.well-known/assetlinks.json` com o SHA-256 da assinatura da Play — modelo em `docs/mobile/assetlinks.modelo.json` |
| iOS Universal Links | entitlement `applinks:playkingcards.com.br` + `/.well-known/apple-app-site-association` com o Team ID — modelo em `docs/mobile/apple-app-site-association.modelo.json` |
| Sem o app instalado | a web abre, como hoje |

Os arquivos de associação **não foram publicados** (dependem do certificado da Play e do Team ID).
O código da sala continua fora do analytics (teste dedicado às origens do app).

## 10. Ciclo de vida

| Peça | Como funciona hoje | No app |
|---|---|---|
| Áudio | `visibilitychange` + `pageshow` + `statechange` (motor V2, aprovado em aparelho) | WebView = mesmo motor do navegador do sistema; **gate de QA** |
| Multiplayer | Colyseus com `onDrop`/`onReconnect` e `recoveryToken` (volta à mesa ao reabrir) | o sistema pode matar o socket em segundo plano; a volta usa o mesmo caminho — **gate de QA** |
| Timers da mesa | `setTimeout`/`setInterval` da página | congelam em segundo plano, como no navegador |
| Analytics | SDK slim, sem autocapture | igual |

Nenhuma automação nova de reconexão foi criada (não há defeito comprovado que peça).

## 11. Áudio no Capacitor

O motor V2 não foi alterado. Dentro do app, iOS = WKWebView (WebKit, o mesmo do Safari em que o V2
foi aprovado) e Android = WebView (Chromium). **Gate de RC no aparelho, já com o app:** segundo plano
e volta, bloquear e desbloquear, ida ao WhatsApp, ligação recebida — 10 voltas, como no gate do V2.
Áudio nativo só com defeito comprovado.

## 12. Privacidade e analytics no app

Conferido, sem mudança: o filtro de saída do PostHog descarta URL, host, caminho e referrer (inclusive
`https://localhost` e `capacitor://localhost`); `sala`, `code` e `token` são mascarados; GeoIP
desligado; sem autocapture; `person_profiles: identified_only`. Teste novo com as origens do app.

## 13. Exclusão de conta — lacunas

> **Fase 9 (25/10/2026): implementada** — no app, na web e no servidor; ver seção 22. A tabela abaixo
> é o retrato da Fase 8, mantido como histórico. Ficam em aberto: prazo de retenção do banco do jogo e
> o expurgo de convidados abandonados (decisões do titular, seção 22.8).

| Exigência | Hoje | O que falta |
|---|---|---|
| Apple 5.1.1(v): excluir a conta **dentro do app** (vale para convidado persistente também) | não existe | tela "Excluir conta" com confirmação |
| Google Play: caminho no app **e** link web para pedir exclusão | não existe | página pública (ex.: `/excluir-conta`) + o mesmo fluxo no app |
| Apagar a conta | cascata pronta: `auth.users` → `players` → `progresso`, `xp_eventos` | endpoint no servidor (Edge Function) que confere o JWT e chama a exclusão com a chave de serviço — **nunca no cliente** |
| Dados das identidades vinculadas | e-mail, nome e foto do Google/Apple (em `auth.users`/`auth.identities`) | apagados junto com o usuário; declarar na Política |
| Partidas | `king_private.partidas` fica (histórico compartilhado, só ids) | decidir: anonimizar ids do excluído ou manter (pseudônimo) |
| Sign in with Apple | — | **revogar o token** na Apple ao excluir (chave privada no servidor) |
| Google | — | desvincular junto (a identidade some com o usuário) |
| Prazo / arrependimento | não definido | definir (ex.: imediato, ou 30 dias) e escrever na Política |
| Retenção de convidados abandonados | não definida | rotina de expurgo |
| Analytics | id anônimo por aparelho, sem vínculo com a conta | nada a apagar; dizer isso na Política |

## 14–15. Prontidão de build

**Android:** compila (debug) ✅; falta upload key + Play App Signing, ícone/splash, `versionCode` do CI,
App Links, QA em aparelho com recorte e em tablet com Android 16.

**iOS:** projeto gerado e validado (27 verificações) ✅; tudo o mais depende de Mac + Apple Developer.

## 16. Dependências

| Pacote | Onde | Classe | Ação |
|---|---|---|---|
| `@capacitor/*` 7 → 8 | app | **P0 resolvido** (API 36) | feito |
| `dompurify` (crítico) | dependência do `posthog-js` | P2 | **não vai no bundle** (variante slim); atualizar o posthog-js numa rodada própria |
| `proxy-addr`, `qs` | express do servidor (`@colyseus/core`) | P1 | `npm audit fix` sem major + deploy do servidor, fora desta frente |
| `vite`, `esbuild`, `source-map-js` | build e servidor de desenvolvimento | P2 | não vão para o app |
| `@colyseus/auth` e cadeia (`grant`, `uuid`, `elliptic`…) | módulo que o KING não usa | P2 | — |

Nenhum `npm audit fix --force`, nenhum major além do Capacitor.

## 17. P0 / P1 / P2

**P0 (bloqueia loja):** assinatura (Android e iOS); ícone e splash; Google nativo configurado
(seção 5) **antes** de mostrar o Google no app; Sign in with Apple no iOS junto com o Google;
exclusão de conta (seção 13); conta Apple Developer + Mac/CI macOS.

**P0 da Fase 9 (decidido):** "Já tenho uma conta" (seção 19); sessão fora do iCloud (decisão B).
→ **Implementados na Fase 9** (seção 22), junto com exclusão de conta, revogação da Apple, página da
Play e App Links; o que resta são os gates manuais da seção 22.7.

**P1:** sessão do convidado em armazenamento durável no app; limites de taxa do Supabase; declarar e-mail/nome/foto nos
formulários; QA de `crypto.subtle` no `capacitor://localhost` (nonce); App Links / Universal Links; `@capacitor/app` + comportamento do link com o app aberto;
`mobile.yml` no remoto (token com escopo `workflow`); `versionCode` automático; QA em aparelho (áudio,
reconexão, recortes, tablet); servidor: `proxy-addr`/`qs`; manifesto de privacidade e formulários
das lojas.

**P2:** região `pt-BR` no iOS; `diag.html` fora do pacote da loja; atualizar `posthog-js`; iPad.

## 18. Próximos gates manuais (do Tito)

1. Google Cloud: clientes OAuth (Web, Android com SHA-1, iOS) e publicar a tela de consentimento.
2. Supabase: Client IDs do Google e da Apple.
3. Apple Developer: conta, Team ID, App ID com Sign in with Apple e Associated Domains, chave do SIWA.
4. Play Console: criar o app, Play App Signing, upload key (a senha só o Tito digita).
5. Arte: ícone e splash.
6. Autorizar o `mobile.yml` (token com escopo `workflow`) ou um runner macOS.
7. Aparelhos para o QA (iPhone e Android).

## 19. "Já tenho uma conta" — arquitetura (decisão C; implementação = P0 da Fase 9)

Dois fluxos que nunca se misturam:

| | **Vincular conta** (existe) | **Já tenho uma conta** (Fase 9) |
|---|---|---|
| Quem | o convidado que quer proteger a conta ATUAL | quem reinstalou, trocou de aparelho ou perdeu os dados |
| Operação | `linkIdentity` sobre o convidado | recuperar a conta que JÁ tem esse Google/Apple |
| Resultado | o MESMO `auth.users.id` ganha a identidade | o aparelho passa a usar a conta existente |

Regras do "Já tenho uma conta":

1. ação separada e explícita ("Já tenho uma conta"), nunca disparada sozinha;
2. a sessão do convidado do aparelho **não é tocada** até a confirmação: a recuperação roda num
   cliente de autenticação ISOLADO (memória, sem gravar), e qualquer falha — rede, cancelamento,
   provedor — deixa tudo como estava;
3. **nada é criado**: se nenhuma conta tem esse Google/Apple, a resposta é "não existe conta com
   ele" (e a tela oferece "Vincular conta" para proteger o convidado atual). Como entrar por ID
   token no Supabase CRIA usuário quando a identidade é desconhecida, a existência é conferida
   ANTES por um endpoint no servidor (Edge Function que confere o ID token e procura a identidade —
   chave de serviço só lá dentro) — sem isso nasceria um jogador paralelo;
4. se a identidade já é deste convidado: nada a fazer;
5. se o convidado do aparelho tem progresso relevante: **confirmação clara** antes de trocar ("o
   progresso deste convidado não vai junto") — sem fusão de contas;
6. a troca é atômica (a sessão recuperada entra de uma vez); o convidado deixado para trás segue a
   regra de expurgo de convidados abandonados (filtrar por "sem identidades", nunca por `is_anonymous`);
7. Google e Apple pela mesma política (o provedor é parâmetro).

> **Premissa corrigida na Fase 9 (antes de implementar):** em vez do endpoint que conferiria o ID
> token e procuraria a identidade (regra 3), a garantia de "nada é criado" ficou no PRÓPRIO Supabase
> Auth: o gancho "Before User Created" recusa qualquer usuário que nasceria com Google/Apple (seção
> 22.3). É atômico (sem a janela entre "conferir" e "entrar"), não manda ID token para servidor nosso
> e não exige guardar os client IDs em mais um lugar. Defesa em profundidade no app: uma conta que
> "nasceu junto" com a identidade é desfeita e nunca adotada.

Contrato previsto na Fase 8 (o implementado está em `apps/web/src/auth/recuperacaoDeConta.ts`):

```ts
type ResultadoDaRecuperacao =
  | { tipo: "mesma-conta" }                                   // a identidade já é deste convidado
  | { tipo: "sem-conta" }                                     // ninguém tem essa identidade; nada criado
  | { tipo: "confirmar"; convidadoTemProgresso: boolean; trocar: () => Promise<ResultadoDaRecuperacao> }
  | { tipo: "recuperada"; userId: string }
  | { tipo: "erro"; motivo: "cancelado" | "rede" | "provedor-recusou" | "indisponivel" };

recuperarConta(provedor: "google" | "apple"): Promise<ResultadoDaRecuperacao>;
```

## 20. Fase 9 — Identidade mobile + exclusão de conta (plano)

| Peça | Só código | Tito | Google Cloud | Apple Developer | Mac/Xcode |
|---|---|---|---|---|---|
| Plugin nativo Google/Apple (`@capgo/capacitor-social-login`) + `registrarFonteNativa` | ✔ | | client IDs | capacidade + chave | build iOS |
| "Vincular conta" no app (Google e Apple) | ✔ (camada pronta) | | ✔ | ✔ | teste |
| "Já tenho uma conta" (seção 19) + endpoint de verificação | ✔ | decisão do texto | ✔ | ✔ | teste |
| Sessão em armazenamento durável (Keystore / Keychain `ThisDeviceOnly`) — resolve durabilidade e a decisão B | ✔ (plugin) | | | | build iOS |
| Exclusão de conta no app + endpoint + página web da Play | ✔ | prazo/política | | revogação do token (chave) | |
| App Links / Universal Links + `@capacitor/app` | ✔ | publicar os arquivos | | Team ID + capacidade | build iOS |
| QA físico (áudio, reconexão, recortes, link, login) | | aparelhos | | | iPhone |
| Compliance (App Privacy, Data safety, Política) | textos | revisão e envio | | | |

## 21. Próximos passos externos (no máximo 3 por vez)

> Atualizado na seção 22.7 (Fase 9): a ordem continua a mesma; a 22.7 traz todos os gates, em sequência.

Ordem pelo caminho crítico: a Apple tem o prazo mais longo (inscrição e verificação podem levar
dias) e trava o iOS inteiro — o relógio dela começa primeiro; o Google é rápido e destrava o teste
no Android.

1. **Apple Developer:** confirmar se a conta do programa já existe (pessoa física ou empresa). Se
   não existir, iniciar a inscrição. Resultado esperado: o **Team ID** (não é segredo).
2. **Google Cloud (OAuth):** criar o cliente **Web** e o cliente **Android** (pacote
   `br.com.playkingcards.king` + SHA-1 da chave de depuração, para os testes). Resultado: os dois
   **client IDs** (não são segredo; o *client secret* do cliente Web vai só para o painel do Supabase,
   pelo próprio Tito, nunca para o chat).
3. **Play Console:** criar o app KING (`br.com.playkingcards.king`) com a **Play App Signing**.
   Resultado: o SHA-1/SHA-256 do certificado de assinatura (para o cliente OAuth de produção e para
   o `assetlinks.json`).

Depois destes: cliente iOS do Google, Supabase (Client IDs), capacidade Sign in with Apple e chave,
arte (ícone e splash), upload key.

## 22. Fase 9 — Identidade mobile + exclusão de conta (implementado, 25/10/2026)

Branch `feat/mobile-identity-compliance`. Nada publicado: nem Production, nem lojas, nem a função,
nem a migração, nem os arquivos de domínio. Fontes oficiais conferidas antes de instalar (25/10):
Capacitor 8.5.3; `@capgo/capacitor-social-login` 8.7.5 (peer `@capacitor/core >=8`, código lido);
`@aparajita/capacitor-secure-storage` 8.0.1 (código lido); `@capacitor/app` 8.1.2; Supabase Auth
(manual linking, `linkIdentity` com ID token, gancho "Before User Created"); Sign in with Apple REST
API (`/auth/token`, `/auth/revoke`); App Review 4.8 e 5.1.1(v); Google Play "Account deletion".

### 22.1 Quem faz o quê

| Peça | Onde | Garantia |
|---|---|---|
| Sessão durável | `auth/sessaoNativa.ts`, `nativo/arranque.ts` | iOS: Keychain `afterFirstUnlockThisDeviceOnly`, sem iCloud. Android: AES-GCM com chave do Keystore; o arquivo fica fora de backup/transferência. Só um marcador sem segredo no localStorage. Migração única do WebView (apaga só depois de gravar). Cofre que não abre → memória (nunca texto puro). |
| Google/Apple nativos | `nativo/loginSocial.ts` | provedor recebe o hash do nonce; Apple pede só e-mail e devolve o código para a revogação; `USER_CANCELLED` = cancelado; a cópia de token que o plugin grava (UserDefaults/SharedPreferences) é apagada com `logout` após TODO pedido; SDK do Facebook fora do pacote (config + `mobile:validar`). |
| Vincular conta | `auth/conta.ts` | `linkIdentity` com ID token sobre o convidado: o mesmo `auth.users.id`. |
| Já tenho uma conta | `auth/recuperacaoDeConta.ts` + gancho do banco | cliente isolado sem persistência; identidade sem conta → recusa no servidor; conta "recém-nascida" → desfeita e nunca adotada; progresso → confirmação; troca só vale conferida na sessão. |
| Excluir conta | `auth/exclusaoDeConta.ts` + `supabase/functions/excluir-conta` | JWT do próprio projeto (JWKS); só o `sub` do token; confirmação `EXCLUIR`; idempotente; Apple revogada ANTES de apagar (falha não bloqueia); exclusão real + cascata; o aparelho só esquece a conta depois do OK. |
| Página da Play | `public/excluir-conta.html`, `vercel.json` | estática, sem script; amarrada por teste aos rótulos reais da tela. |
| App Links | `nativo/linkDoApp.ts`, `preparar-mobile.mjs`, `scripts/gerar-well-known.mjs` | só `https://playkingcards.com.br/` (raiz exata); o link vira no máximo um código no campo da Home — nunca entrada na sala. |
| Privacidade | `privacidadeDaIdentidade.test.ts` e testes de log da função | identidade nunca vai para analytics nem console; `$geoip_disable=true` mantido. |
| Crédito com conta excluída | migração `20261025130000` | quem excluiu a conta (lápide em `king_private.contas_excluidas`, só id + hora) não derruba o XP da mesa; id que nunca foi jogador continua reprovando tudo. |
| Retenção da lápide (E-2) | migração `20261026120000` + `progresso/servico.ts` | a lápide sai depois de 30 dias (720 h, relógio do banco) e NUNCA enquanto o servidor ainda puder pedir um crédito que a leia (outbox, crédito em voo, sala viva) — §22.11. |
| Manifesto de privacidade iOS | `preparar-mobile.mjs` → `PrivacyInfo.xcprivacy` | UserDefaults (CA92.1) declarado; sem rastreamento; tipos de dado da política. |
| Sessão que não some calada | `auth/clienteSupabase.ts` | 429 na renovação vira 503 (a sessão fica); sessão encerrada pelo servidor deixa aviso ao jogador. |

### 22.2 Provedores por plataforma

- **Android:** Google (Credential Manager). Apple no Android exigiria servidor de redirecionamento — P2.
- **iPhone:** Apple sempre; Google só com o client ID iOS, e nunca sem a Apple (diretriz 4.8).
- **Web:** Google por OAuth (vínculo, como antes). "Já tenho uma conta" na web — P2.
- Consequência conhecida (P2): quem salvou SÓ com Apple no iPhone não recupera no Android, e vice-versa
  sem Google no iPhone. Mitigação: oferecer os dois no iPhone assim que houver o client ID iOS.

### 22.3 O gancho "conta só nasce como convidado"

`supabase/migrations/20261025120000_cadastro_so_convidado.sql` cria
`public.king_antes_de_criar_usuario(event jsonb)`: recusa (403) quem nasceria com Google/Apple
(`app_metadata.provider`, `app_metadata.providers` ou `identities`); aceita o convidado anônimo;
nunca lança (lançar travaria o cadastro do convidado); só `supabase_auth_admin` executa. Testado em
Postgres real (`npm run test:cadastro-sql`: 8 testes + 6 mutações). Ativar no painel DEPOIS de aplicar;
desfazer = desligar no painel ANTES do rollback.

### 22.4 Exclusão: o que some e o que fica

Some: o usuário (convidado também), as identidades Google/Apple, `players` (apelido, avatar),
`progresso` (XP, nível, sequência) e `xp_eventos` — pela cascata das FKs. Fica: `king_private.partidas`
(início, fim, quantos humanos/bots — sem id de jogador) e a medição anônima do PostHog (nunca ligada à
conta). **Fica por tempo limitado (E-2):** a lápide `king_private.contas_excluidas` — o UUID da conta
(pseudônimo, NÃO dado anônimo) e a hora da exclusão — e, se houver crédito pendente, o arquivo dele no
outbox da VPS (o mesmo UUID, a posição e o horário). Prazo normal de 30 dias (720 h, relógio do banco),
estendido só enquanto o servidor ainda puder pedir um crédito que leia a lápide; depois, expurgo
automático pelo servidor (§22.11). Sem acesso público. Apple: troca do código novo + `/auth/revoke`; sem código (fora do iPhone) ou com falha, a
exclusão segue e a tela mostra o caminho manual (Ajustes → ID Apple → Iniciar Sessão com a Apple).

### 22.5 Configuração (nenhum segredo no repositório)

| Nome | Onde | Segredo? |
|---|---|---|
| `VITE_KING_GOOGLE_LINK=1` | build do app/web | não (liga o vínculo) |
| `VITE_KING_GOOGLE_WEB_CLIENT_ID` | build do app | não (aud do token no Android) |
| `VITE_KING_GOOGLE_IOS_CLIENT_ID` | build do app **e** `mobile:preparar` (esquema de URL) | não |
| `KING_APPLE_TEAM_ID`, `KING_APPLE_KEY_ID`, `KING_APPLE_CLIENT_ID` (= `br.com.playkingcards.king`) | segredos da função | não |
| `KING_APPLE_PRIVATE_KEY` (o `.p8` inteiro) | segredos da função | **sim** — só no Supabase, digitado pelo Tito |
| `KING_ORIGENS_EXTRAS` | segredos da função (opcional, só `https://`) | não |
| `KING_ANDROID_SHA256`, `KING_APPLE_TEAM_ID` | `node scripts/gerar-well-known.mjs` | não |

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` o Supabase injeta na função; a chave de serviço nunca vai
para app, repositório nem servidor do jogo.

### 22.6 Provas

Testes novos: sessão no cofre (17, inclusive com o SDK real), sessão perdida (4, SDK real; 3 mutantes),
login nativo (11), vínculo/visibilidade (+4), vínculo em aparelho novo (4 novos no lugar de 1 da Fase 8;
2 mutantes), recuperação
(30, Google e Apple; 8 mutantes mortos), exclusão no app (10), painel e Home (8), página da Play (8),
links do app (8), privacidade (4); função de exclusão (22, com JWT ES256 real; 9 mutantes mortos);
gancho em Postgres real (8 + 6 mutações); crédito com conta excluída (X1–X6 na suíte de progresso:
58/58 e 33 mutações, inclusive a exclusão feita pelo papel do Auth); arquivos de domínio (6); variável
do build (1); e2e do painel no navegador real (24, 6 viewports, inclusive 852×300); `mobile:validar`
com 36 verificações (cada verificação nova reprovou antes da correção).

### 22.7 Gates manuais, na ordem segura

1. **Supabase (painel):** "Manual linking" ligado; provedor Google com Client IDs = Web (+ iOS, quando
   houver); provedor Apple com Client ID = `br.com.playkingcards.king`; recomendado desligar cadastro
   por e-mail.
2. **Supabase (SQL Editor do Tito):** aplicar `20261025120000_cadastro_so_convidado.sql`; ligar
   Authentication → Hooks → "Before User Created" → `public.king_antes_de_criar_usuario`; **conferir
   na hora** que um convidado novo ainda nasce (aba anônima → entrar online). Se não nascer: desligar
   o gancho. Depois, aplicar `20261025130000_credito_com_conta_excluida.sql` — **ANTES** de publicar a
   função de exclusão (sem ela, excluir a conta pode custar o XP da mesa inteira).
3. **Função:** `supabase functions deploy excluir-conta --no-verify-jwt` + segredos da 22.5. Em
   Authentication → URL Configuration, incluir `https://playkingcards.com.br/vincular` nas Redirect
   URLs (o retorno do Google na web saiu da raiz).
4. **Google Cloud:** clientes Web, Android (SHA-1 de depuração e, depois, o da Play) e iOS.
5. **Apple Developer:** no App ID, ligar "Sign in with Apple" e "Associated Domains"; criar a chave do
   Sign in with Apple (.p8) e pôr nos segredos da função.
6. **Play Console:** app + Play App Signing → SHA-256 → `gerar-well-known` → commit → publicar só com
   autorização (junto com a main).
7. **Build de teste** com as variáveis da 22.5 e o QA físico (vincular, já tenho uma conta, excluir,
   reinstalar, link de convite) em Android e iPhone.

### 22.8 Decisões pendentes do titular

Nome do desenvolvedor como aparecerá na loja (a página cita "Tito Viveiros"); retenção do banco do
jogo e expurgo de convidados abandonados; prazo de resposta a pedidos de exclusão por e-mail; conferir
os tipos de dado do `PrivacyInfo.xcprivacy` contra a ficha "Privacidade do app" do App Store Connect.

**Notas para a revisão da Apple (colar no App Store Connect):** "O KING não pede cadastro: o jogador
começa como convidado. Para criar e salvar a conta: tela inicial → Conta (ícone 👤 no topo) →
Continuar com a Apple. Para recuperá-la em outro aparelho: Conta → Já tenho uma conta. Para excluir:
Conta → Excluir conta → digitar EXCLUIR → Excluir minha conta (a Apple pede confirmação e o acesso é
revogado)."

### 22.9 Red team da Fase 9 (um) — o que foi achado e o que foi feito

| # | Achado | Gravidade | Desfecho |
|---|---|---|---|
| 1 | Excluir a conta derrubava o crédito de XP da mesa inteira (FK 23503), com retentativa eterna | P0 | corrigido: lápide + crédito tolerante (3351a97), T12 preservado, X5 provou a exclusão pelo papel do Auth |
| 2 | Sem `PrivacyInfo.xcprivacy`: envio barrado (ITMS-91053, UserDefaults do plugin) | P0 | corrigido (86eba90) |
| 3 | Aparelho novo: todo "Continuar com a Apple/Google" dava erro (revisor) | P1 | corrigido: o convidado nasce depois da credencial (125c79d) |
| 4 | 429 na renovação apagava a sessão e criava convidado novo calado | P1 | corrigido: 429→503 só na renovação + aviso de sessão encerrada (6e56485) |
| 5 | App Link do Android capturaria o retorno do Google na web | P2 | corrigido: retorno em `/vincular` (b3feea0) |
| 6 | Cofre que recusa a migração faria nascer outro convidado | P2 | corrigido (db4593c) |
| 7 | Conta sumia se o plugin registrasse depois do arranque | P2 | corrigido (db4593c) |
| 8 | Política não citava nome/foto do Google guardados pelo Supabase | P2 | corrigido (db4593c) |
| 9 | Esquema de URL do Google no iOS lido só do ambiente (não do `.env.local`) | P2 | corrigido (456e8c9) |
| 10 | Fechar o painel na confirmação não revogava a sessão nova; fechar após trocar não recomeçava | P2 | corrigido (db4593c) |
| 11 | "Outra conta" Apple na exclusão deixava o acesso recém-criado | P2 | corrigido (fdfef76) |
| 12 | Conta só com Apple não se recupera no Android/web (e vice-versa) | P2 | aberto — oferecer Google no iPhone quando houver o client ID iOS |
| 13 | A função aceita access token de sessão já encerrada (≤ 1 h) | P2 | aberto — conferir a sessão com `/auth/v1/user` numa rodada própria |
| 14 | No iPhone, se a leitura das identidades falhar, a exclusão segue sem revogar | P2 | aceito — o servidor avisa e a tela mostra o caminho manual |
| 15 | O plugin só limpa a cópia do token Google no Android se `clearRestoreCredential` der certo | P2 | mitigado — arquivo fora do backup; conferir no aparelho |
| 16 | Sem política de retenção para convidados abandonados | P2 | decisão do titular (22.8) |

A sugestão do red team de tratar 23503 como erro permanente no servidor NÃO foi adotada: com a lápide,
23503 só sobra na corrida "exclusão no meio do crédito", e é a retentativa que a resolve.

### 22.10 Rollout controlado — sequência final (revisada em 25/10/2026, após a CI verde de 1662f92)

Backend PRIMEIRO, web por último: tudo do backend é compatível com o web que está em Production
(7c3d72f) — se a integração for desfeita, o backend fica como está, sem prejuízo.

| Passo | O quê | Quem | Conferência (só leitura) |
|---|---|---|---|
| 0 | CI verde no SHA FINAL da branch (o backend é idêntico ao de 1662f92) | — | `gh run list --branch feat/mobile-identity-compliance` |
| A | SQL Editor: `20261025120000_cadastro_so_convidado.sql` | Tito | `select has_function_privilege('supabase_auth_admin','public.king_antes_de_criar_usuario(jsonb)','execute') as auth, has_function_privilege('anon','public.king_antes_de_criar_usuario(jsonb)','execute') as anon;` → `true, false` |
| B | Authentication → Hooks → "Before User Created" → Postgres → `public.king_antes_de_criar_usuario` → ligar | Tito | painel mostra o gancho ligado |
| C | NA HORA: aba anônima em playkingcards.com.br → Jogar com amigos → Criar uma sala (nasce convidado) | Tito | `select count(*) from auth.users where is_anonymous and created_at > now() - interval '5 minutes';` > 0. Se falhar: DESLIGAR o gancho (instantâneo). |
| D | SQL Editor: `20261025130000_credito_com_conta_excluida.sql` — ANTES de E | Tito | `select position('contas_excluidas' in pg_get_functiondef('king_private.creditar_partida(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)'::regprocedure)) > 0 as credito_novo, has_function_privilege('king_server','king_private.creditar_partida(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)','execute') as servidor, exists (select 1 from pg_trigger where tgname = 'players_lapide_da_exclusao') as gatilho;` → `true, true, true`; e a próxima partida online real credita XP normalmente |
| D2 | SQL Editor, nesta ordem: `supabase/rollout/retencao-checkpoint-1-antes.sql` (só leitura → `pronto_para_aplicar = true`); `supabase/rollout/retencao-aplicar.sql` (a E-2 `20261026120000_retencao_das_lapides.sql` verbatim, numa transação com recusas, retrato e conferências — nenhuma lápide sai; última linha "RETENÇÃO DAS LÁPIDES (E-2) APLICADA E CONFERIDA"); `supabase/rollout/retencao-checkpoint-3-depois.sql` (só leitura → `tudo_certo = true`) — ANTES de S e de E | Tito | `select to_regprocedure('king_private.expurgar_lapides(uuid,uuid[])') is not null as expurgo, has_function_privilege('king_server','king_private.expurgar_lapides(uuid,uuid[])','execute') as servidor, (select count(*) from king_private.expurgo_das_lapides) as estado;` → `true, true, 1` |
| S | deploy do servidor na VPS com o expurgo (`scripts/deploy-vps.sh`, que confere o artefato; hoje a VPS está em 34c5d89 e o script acompanha `feat/multiplayer-v1`) — ANTES de E | Tito (Web Terminal), com autorização | log `[king] progresso: closed` e nenhum `expurgo das lápides falhou`; em ≤ 1 h, `select ultima_rodada from king_private.expurgo_das_lapides;` não nulo |
| E | `supabase functions deploy excluir-conta --no-verify-jwt` (segredos da Apple podem esperar o iOS) | Tito, ou eu com autorização | lista de funções do painel |
| F1 | `node scripts/smoke-excluir-conta.mjs --url https://<ref>.supabase.co --chave <publishable>` — não cria nada | eu, com autorização | `APROVADO — 5 verificações` |
| F2 | o mesmo com `--autorizado-criar-convidado`: UM convidado descartável nasce, é recusado sem EXCLUIR, é excluído e a repetição dá `ja-excluida` | autorização EXPLÍCITA (cria e apaga um usuário de Production) | `APROVADO — 9 verificações` + a consulta da lápide impressa pelo script → `1, 0, 0` |
| G | fast-forward da main para o SHA final → Vercel Production → smoke não destrutivo. Só com S PROVADO: é aqui que os textos de "30 dias" (privacidade e /excluir-conta) vão ao ar | autorização | Home, `/excluir-conta` 200, `/privacidade` nova; rollback = Instant Rollback para o deploy 7306744060 (7c3d72f) |

Por que F2 é obrigatório antes de G: é a única prova, no projeto REAL, de que a exclusão feita pelo
papel do Auth atravessa a cascata e o gatilho da lápide (no teste X5 isso foi SIMULADO em Postgres).

A–C são independentes de D–G: servem ao "Já tenho uma conta" do APP, não à web. Ficam primeiro porque
o risco é imediato e reversível num clique; se C falhar, o gancho fica desligado e D–G seguem.

NÃO são pré-requisito de G (só de ligar o vínculo / publicar o app): Manual linking, Client IDs do
Google e da Apple, Redirect URL `https://playkingcards.com.br/vincular`, segredos da Apple, arquivos
de domínio (`gerar-well-known`).

### 22.11 Retenção das lápides (E-2 — decisão do titular: opção B, 30 dias)

**Regra.** A lápide (`king_private.contas_excluidas`: o UUID da conta excluída — pseudônimo, não dado
anônimo — e a hora da exclusão, pelo relógio do banco) só existe para que o crédito de uma partida que
incluía essa conta não derrube o XP dos outros. Prazo normal: **30 dias (720 h)**. Exceção: ela fica
enquanto o servidor do jogo ainda puder pedir um crédito que a leia. Expurgo cego por relógio (pg_cron)
é proibido.

**Quem ainda pode ler uma lápide** — é o que o servidor protege:

1. pendência no outbox da VPS — sem prazo: fica até o banco confirmar;
2. crédito em voo (inclusive o que não conseguiu gravar no outbox);
3. SALA VIVA — o token só é conferido na entrada e a reserva do lobby devolve o assento sem token: uma
   partida pode começar muito depois de uma exclusão (achado 1 do red team do desenho). A sala
   ENCERRADA não conta: o crédito dela nasceu na transição para `finished` e ela não joga de novo.

Quem entra numa sala DEPOIS do retrato entra com token válido (≤ 1 semana, teto do Supabase): a lápide
dele, se houver, é jovem demais para o prazo.

**Mecanismo** — migration `20261026120000_retencao_das_lapides.sql` + `apps/server/src/progresso/`:

- `king_private.expurgar_lapides(p_outbox uuid, p_protegidas uuid[])`: SECURITY DEFINER (dono
  `king_progress_owner`, `search_path` vazio, `lock_timeout` 5 s), EXECUTE só para `king_server`, que
  continua sem privilégio de tabela nenhum. Tira só lápide com `excluida_em < now() - 720 h` fora da
  lista. NULL é erro (nunca "nada pendente"). Devolve só contagens (`removidas`, `retidas`).
- `king_private.expurgo_das_lapides` (uma linha): o MARCADOR do outbox registrado e contadores
  (`rodadas`, `lapides_removidas`, `ultima_rodada`), sem dado pessoal. O marcador é o arquivo
  `.king-outbox` (id aleatório) no diretório do outbox, criado pelo inventário do expurgo e nunca por
  `gravar()`. O banco registra o primeiro e recusa outro (`KL001`): diretório trocado, desmontado ou
  recriado vazio não passa por "nada pendente".
- `registrar_conta_excluida` (redefinida): a hora da lápide é a da exclusão MAIS RECENTE do id.
- Servidor, uma vez depois do boot e de hora em hora (só `index.ts` liga; a sonda nunca), só em
  `closed`:
  1. UMA tentativa para cada pendência do outbox — crédito entregue deixa de proteger;
  2. o retrato, num trecho síncrono: outbox ESTRITO (ausente, ilegível, arquivo que não valida ou
     marcador estragado = adia), créditos em voo e salas vivas (`progresso/salasVivas.ts`, alimentado
     pelo `KingRoom`);
  3. a chamada.

  28P01 e ECIRCUITBREAKER seguem o disjuntor; qualquer outra falha vira log, e nenhuma lápide sai. A
  rodada nunca lança: uma rejeição solta derrubaria o processo do jogo. Pelo mesmo motivo, toda tarefa em
  segundo plano do serviço termina registrada (`#acompanhar`), inclusive a meia-abertura do disjuntor,
  que antes podia lançar com o outbox ilegível. O boot liga o expurgo nos dois desfechos de `iniciar()`.
- Todo script que sobe o servidor (`servidor-isolado.mjs`, `verificar-modo-persistente.mjs`,
  `verificar-modo-b-real.mjs`) aponta `KING_PROGRESS_ENV_FILE` para um arquivo inexistente: na VPS, um
  filho com o progresso de produção seria uma 2ª instância expurgando sem ver as salas do PM2.
- Log: `expurgo das lápides ativo — 1ª rodada concluída` (uma vez por boot); `lápides: N expurgada(s), M
  vencida(s) retida(s) — ainda em aberto`; `expurgo das lápides adiado: <motivo>` (a cada rodada adiada);
  `expurgo das lápides falhou: <código>`. Nunca id.

**Operação.**

- Conferência só de leitura (SQL Editor):

  ```sql
  select (select count(*) from king_private.contas_excluidas) as lapides,
         (select count(*) from king_private.contas_excluidas where excluida_em < now() - interval '720 hours') as vencidas,
         (select min(excluida_em) from king_private.contas_excluidas) as mais_antiga,
         e.rodadas, e.lapides_removidas, e.ultima_rodada
    from king_private.expurgo_das_lapides as e;
  ```

  - Normal: `vencidas = 0` (ou maior que 0 só enquanto o log disser "retida(s) por pendência") e
    `ultima_rodada` com menos de 2 h.
  - `ultima_rodada` com mais de 48 h = vermelho: ler os logs `expurgo das lápides adiado:` e `falhou:`.
- Anomalia, só leitura: `select count(*) from king_private.contas_excluidas x join auth.users u on u.id = x.player_id;`
  precisa dar 0.
  - Maior que 0 = alguém apagou `public.players` à mão com a conta viva (proibido).
  - Essa conta é pulada no crédito e, depois do expurgo, derrubaria a mesa. Exclusão é só pela conta.
- Desligar sem deploy: `revoke execute on function king_private.expurgar_lapides(uuid, uuid[]) from king_server;`
  (o servidor registra `expurgo das lápides falhou: 42501/transitoria` e mantém tudo). Religar: o `grant`
  da migration.
- Depois da 1ª rodada do passo S (logo depois do D2 o marcador é nulo, por desenho) e depois de todo reset
  do marcador, conferir que o banco registrou o diretório CERTO:
  `select outbox from king_private.expurgo_das_lapides;` igual a `cat /var/lib/king/progresso-outbox/.king-outbox`.
  Qualquer chamador com o papel `king_server` registraria o seu (e o servidor de verdade cairia em KL001 —
  falha segura, mas o expurgo para).
- Arquivo ILEGÍVEL no outbox (log `pendência ilegível mantida no outbox para análise: <nome>.json`) segura
  todo expurgo até alguém decidir. Ele nunca é reenviado, então:
  - se der para reconstruir o resultado, gravar a versão válida no lugar (o crédito sai na rodada seguinte);
  - se não der, MOVER (não apagar) para fora do diretório, por exemplo para `/var/lib/king/progresso-quarentena/`:
    aquele crédito já estava perdido; o expurgo volta na rodada seguinte.
- Outbox trocado de propósito (outro disco, outra VPS): copiar o diretório INTEIRO, com o `.king-outbox`.
  - Se o antigo se perdeu de vez: primeiro conferir que nenhum arquivo dele ficou para trás.
  - Só então: `update king_private.expurgo_das_lapides set outbox = null;` (o próximo expurgo registra o novo).
- Nunca:
  - apagar ou renomear arquivo VÁLIDO do outbox à mão, nem o `.king-outbox` (ilegível: só pela saída acima);
  - rodar uma 2ª instância do servidor com progresso ligado (PM2 fork, `instances: 1`);
  - apagar linha de `players` direto.
- Prazo prático: 30 dias, mais até 1 h de granularidade, mais o tempo em que o servidor esteve fora, sem
  banco ou com a rodada adiada.

**Rollback.** `supabase/rollback/20261026120000_retencao_das_lapides_rollback.sql`:

- tira a função e devolve o gatilho ao texto do D; as lápides ficam intactas;
- trava PRIMEIRO o estado (`exclusive`) e depois a lápide (`share`): com a ordem inversa, um expurgo no meio
  fechava um ciclo com o `drop table` (40P01). "lock timeout" = um expurgo estava no meio: rodar de novo;
- o estado do expurgo FICA se alguma lápide já saiu: é a prova de exclusão real;
- o rollback pré-E do passo D recusa enquanto existir o estado — desfazer a E-2 antes;
- o pós-E passou a travar a lápide em modo `share`: um expurgo no meio abortava a CONFERÊNCIA 4 à toa;
- reaplicar a E-2 depois de um rollback que MANTEVE o estado: colar a E-2 crua
  (`20261026120000_retencao_das_lapides.sql`), que reaproveita a linha e o marcador — o arquivo do D2
  (`supabase/rollout/retencao-aplicar.sql`) é só para a 1ª aplicação e recusa por desenho.

**Rollout.** D2 (SQL Editor: `supabase/rollout/retencao-aplicar.sql`, entre os checkpoints 1 e 3 de `supabase/rollout/`) → S (deploy da VPS com o expurgo; `deploy-vps.sh` confere
o artefato) → E → … → G só depois de S provado (`ultima_rodada` não nula). O convidado descartável do
F2 deixa uma lápide, que sai sozinha em 30 dias.

- Antes de S: o outbox de produção existe e não tem `.json` ilegível (`ls -la /var/lib/king/progresso-outbox`);
  senão a rodada adia, `ultima_rodada` fica nula e G espera.
- S vai pelo `deploy-vps.sh`, buscado de `feat/multiplayer-v1`: as conferências novas do artefato só valem
  com esta versão do script nesse branch.
- Depois de G, um rollback da VPS para um artefato antigo ou `KING_PROGRESS_MODE=disabled` param o expurgo
  em silêncio: é a conferência do Tito (`ultima_rodada` > 48 h) que pega.
- Copiar o outbox para outro lugar: sempre a cópia ATUAL — uma cópia velha, com o mesmo marcador, seria
  aceita sem as pendências de depois.

**Recomendações em aberto (decisão do titular).** A tela "Excluir conta" do app não cita a retenção
temporária. Texto sugerido, curto: "Por até 30 dias, só um código técnico da conta excluída fica guardado,
para não atrapalhar a contagem das partidas dos outros." Mexe no painel (e2e visual em 6 viewports):
rodada própria, com prévia.

**Riscos residuais (documentados, não resolvidos aqui).**

1. 2ª instância do servidor no MESMO outbox, servindo salas próprias: o expurgo de uma não vê as salas
   da outra. Fora do suportado (1 instância).
2. Conta viva com lápide (players apagado à mão): ver a consulta de anomalia.
3. `retidas` conta ao `king_server` se um id que ele cita tem lápide vencida — o servidor já sabe disso
   pelo próprio crédito.
4. Disco sem hard link (`linkSync`): o marcador não nasce e a rodada adia para sempre (com log). Conferir
   antes de S: `df -T /var/lib/king` (ext4/xfs têm hard link).
