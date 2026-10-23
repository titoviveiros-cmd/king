# KING — Release Candidate mobile (Fase 8, 23/10/2026)

O que existe, o que falta e em que ordem, para o KING virar app publicável na Play e na App Store.
**Esta fase não publica nada** — nem lojas, nem Production. Ela tira de cima da mesa os riscos
técnicos que só apareceriam na revisão das lojas.

Decisões de produto registradas nesta fase:

- **iOS: o primeiro envio é SÓ IPHONE**, em paisagem. Suporte a iPad (retrato, multitarefa,
  janelas redimensionáveis) é evolução posterior, não bloqueio. **`UIRequiresFullScreen` não é a
  saída** (depreciado no iPadOS 26).
- Rota mobile continua sendo **Capacitor** (o mesmo `dist/` da web dentro do app).

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
| Backup / transferência entre aparelhos | `app_webview/` (onde mora a sessão do convidado) **excluído** do backup na nuvem e da transferência (`dataExtractionRules` + `fullBackupContent`), validado no portão — restaurar a sessão noutro aparelho CLONARIA a identidade e o Supabase derrubaria as duas (red team) | ✅ (decisão a confirmar pelo Tito) |
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
| Backup do iCloud / Início Rápido | levam os dados do WKWebView (a sessão do convidado) — mesmo risco de clonar a identidade do Android; excluir pede código nativo | P1 (decisão) |

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

**Sem caminho de volta (decisão de produto pendente):** depois de reinstalar ou trocar de aparelho,
ligar o mesmo Google/Apple responde "já ligada a outro jogador" — não existe "entrar na conta
ligada". O botão diz "Salvar progresso", o que promete recuperação. E a revisão da Apple reutiliza o
próprio Apple ID entre envios: na 2ª revisão, o Sign in with Apple mostraria esse aviso. Saídas:
mudar o texto e explicar nas notas da revisão, ou um "entrar na conta ligada" com confirmação (que
troca o convidado do aparelho pela conta — decisão do Tito).

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

**Corrigido nesta fase (red team, P0, defeito anterior):** quando a renovação da sessão falhava (rede,
5xx, 429 passageiro), o SDK mantinha a sessão guardada e respondia `session: null` com `error` — e o
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

**P1:** sessão do convidado em armazenamento durável no app; limites de taxa do Supabase; backup do
iCloud (decisão); caminho de volta para conta ligada (decisão); declarar e-mail/nome/foto nos
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
