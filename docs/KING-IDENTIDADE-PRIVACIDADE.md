# KING — Identidade: dependências, extensão e privacidade

Documento da fase de identidade permanente. Cobre três coisas que a fase **introduziu** e que
precisam estar escritas antes de qualquer publicação: o que passou a depender do identificador do
aplicativo, onde um provedor novo se encaixa, e quais dados passaram a existir.

Não é a Política de Privacidade. É a base factual da qual ela — e os formulários do Google Data
Safety e do Apple App Privacy — serão escritos.

---

## 1. `br.com.playkingcards.king` — CONGELADO

O identificador é definitivo. Trocá-lo depois da primeira publicação numa loja **não é uma
mudança de configuração**: é um aplicativo novo, com instalações, avaliações e histórico zerados,
e sem caminho de atualização para quem já instalou.

### 1.1 O que já está amarrado a ele, hoje, no código

| Ponto | Onde | Como está garantido |
|---|---|---|
| Fonte da verdade | [capacitor.config.ts:25](../apps/web/capacitor.config.ts) | `appId: "br.com.playkingcards.king"` |
| Android `applicationId` | `android/app/build.gradle` (gerado) | [validar-mobile.mjs:76-78](../scripts/validar-mobile.mjs) falha se divergir do `appId` |
| iOS `PRODUCT_BUNDLE_IDENTIFIER` | `ios/App/App.xcodeproj` (gerado) | [validar-mobile.mjs:138-139](../scripts/validar-mobile.mjs) falha se divergir do `appId` |
| CI | [.github/workflows/mobile.yml](../.github/workflows/mobile.yml) | roda o validador nos dois sistemas |

`android/` e `ios/` são **gerados e ignorados pelo Git**. O identificador não vive neles: vive no
`capacitor.config.ts`, e o validador é quem impede os projetos nativos de derivarem em silêncio.
Isso é o que torna o congelamento verificável em vez de combinado.

### 1.2 O que passa a depender dele a partir de agora

Nenhum destes existe ainda. Todos nascem amarrados ao identificador, e é por isso que ele precisa
estar congelado **antes** — cada um deles é um lugar a mais onde uma troca custaria retrabalho ou
seria simplesmente impossível.

| Ponto | Por que depende | Quando entra |
|---|---|---|
| **Keystore Android** | A chave de upload fica associada ao pacote na Play Console. Pacote novo = app novo | P0 de publicação |
| **Certificado + provisioning iOS** | O App ID da Apple **é** o bundle identifier; o profile é emitido para ele | P0 de publicação |
| **Play Store — listagem** | O pacote é a chave primária da ficha. Não se renomeia depois de publicado | Publicação |
| **App Store — registro** | O App ID é criado uma vez e não se edita | Publicação |
| **OAuth Google (Android)** | O client Android é registrado por `package name` + fingerprint SHA-1 do keystore | Portão do Google |
| **Sign in with Apple** | A capability é emitida para o App ID | Quando houver conta Apple |
| **Deep links / App Links** | `assetlinks.json` e `apple-app-site-association` referenciam o pacote | Se e quando existirem |

### 1.3 Uma armadilha concreta do OAuth, já visível na configuração atual

O `capacitor.config.ts` define `androidScheme: "https"` e `iosScheme: "capacitor"`. Dentro do
aplicativo, portanto, a origem da página **não é** `playkingcards.com.br`: é `https://localhost`
no Android e `capacitor://localhost` no iOS.

Isso importa porque o redirecionamento do OAuth precisa voltar **para dentro do aplicativo**, e
uma URL de redirecionamento pensada para o navegador não faz isso. É o tipo de detalhe que só
aparece no primeiro login real num aparelho, depois de tudo pronto. Fica registrado aqui para ser
tratado no portão do Google, e não descoberto nele.

---

## 2. Onde um provedor novo se encaixa (Apple incluída)

A abstração é **provedor-neutro por construção**, e isso não é preparação especulativa: convidado,
Google e Apple chegam pelo **mesmo emissor** (o Supabase) e se distinguem por *claim*, não por
caminho de código.

**Nada de Apple foi simulado.** Não há capability, não há credencial falsa, não há caminho de
código fingindo funcionar. O que existe são os pontos onde ela entra:

| Ponto de extensão | Arquivo | O que muda quando a Apple existir |
|---|---|---|
| `Provedor` | [server/auth/identidade.ts:38](../apps/server/src/auth/identidade.ts) | `"apple"` **já está** no tipo |
| `provedorDe()` | [server/auth/identidade.ts:105](../apps/server/src/auth/identidade.ts) | o ramo `app_metadata.provider === "apple"` **já existe** |
| `ProvedorDeIdentidade` | [web/auth/identidade.ts:34](../apps/web/src/auth/identidade.ts) | interface de uma função; um provedor novo é um adaptador novo, não uma cirurgia |
| Verificação JWT | [server/auth/identidade.ts:127](../apps/server/src/auth/identidade.ts) | **nada muda** — mesmo emissor, mesmo JWKS, mesma assinatura |

Do lado do servidor, portanto, **acrescentar a Apple não mexe em nenhuma linha deste código.** O
trabalho é inteiramente externo: conta de desenvolvedor, App ID com a capability, e o provedor
habilitado no painel do Supabase.

O que **não** existe e não foi inventado: nenhum `linkIdentity` de Apple, nenhum botão, nenhuma
`entitlement`, nenhuma configuração de Xcode.

---

## 2-A. Google: vínculo, não login paralelo

**A regra, antes de tudo:** quem joga o KING **já tem conta**. Ao entrar online pela primeira vez
o jogador vira um convidado de verdade no Supabase, e o `playerId` da mesa é o `sub` desse
convidado. Conectar o Google **não cria um usuário** — pendura uma identidade Google **no mesmo**
`auth.users.id`. Antes e depois, o mesmo id; antes e depois, o mesmo `playerId`.

Por isso o código usa `linkIdentity`, nunca `signInWithOAuth`. O segundo é *entrar*, e entrar com
um Google que ainda não pertence ao convidado criaria **outro** usuário — o jogador voltaria dono
de uma conta vazia, com a antiga órfã. A porta do KING para o SDK
([`clienteSupabase.ts`](../apps/web/src/auth/clienteSupabase.ts)) **não declara** `signInWithOAuth`:
trocar um pelo outro não compila.

### Como o retorno é conduzido

| Decisão | O que foi escolhido | Por quê |
|---|---|---|
| Fluxo | **PKCE** (`flowType: "pkce"`) | o implícito devolveria `access_token` no fragmento da URL, onde ele entra em histórico, em `Referer` e em captura de tela |
| Detecção automática | **`detectSessionInUrl: false`**, mantido | ligá-lo faria o SDK processar qualquer URL com `code=` no arranque, calado, antes de o KING saber se aquilo era transação sua |
| Reconhecimento | um ponto só, na Home, por `?conta=google` | retorno é um evento do produto, não um efeito colateral de carregar a página |
| Limpeza | `history.replaceState` logo depois, em **todos** os caminhos | um `code` que sobrevive na barra de endereços é um retorno que alguém repete sem querer |
| Cliente | **uma instância** de módulo, compartilhada | o `code_verifier` do PKCE vive no storage do cliente que **iniciou** o fluxo; um segundo cliente no retorno falharia por verificador ausente |

### A trava que importa

Antes de sair para o Google, grava-se uma linha **sem segredo nenhum**: qual usuário iniciou, qual
provedor, quando. Na volta, o usuário que retorna é comparado com esse. Divergiu, **fecha**: não há
vínculo, não há merge, não há cópia de progresso, não há `public.players` novo. A UI diz uma frase
neutra e o jogo continua.

E o retorno **nunca cria convidado**. Criar um ali seria o pior desfecho da fase: o Google ficaria
vinculado a um usuário recém-nascido e o antigo ficaria órfão. A separação é explícita —
*preciso de identidade para jogar* pode criar convidado (`token()`); *estou concluindo um vínculo*
não pode, e falha fechado.

A prova do vínculo é `getUserIdentities()` com `provider === "google"` no **mesmo** `user_id` —
nunca `user_metadata`, que é o que o token diz de si mesmo.

### O que NÃO é guardado

`access_token`, `refresh_token`, `provider_token`, `provider_refresh_token`, credencial do Google
e `code_verifier` (esse é do SDK, e fica com ele). O KING grava uma coisa só: o id esperado da
transação, e o apaga ao terminar.

### Google ainda está DESLIGADO

Nada disso aparece em Production. O botão depende de `VITE_KING_GOOGLE_LINK` **e** de identidade
configurada; sem as duas, a Home é exatamente a de hoje. O gate existe porque o Google só passa a
funcionar quando alguém o configurar fora do repositório — e um convite publicado antes disso seria
um caminho para o erro.

**O que a fase seguinte precisará configurar, fora do código:**

| Onde | O quê |
|---|---|
| Google Auth Platform | um OAuth Client Web; **origem autorizada** `https://playkingcards.com.br`; **redirect URI** `https://dwkpkpmfsqvyarjtcmjd.supabase.co/auth/v1/callback` (quem recebe o Google é o Supabase, não o KING); escopos apenas de autenticação (`openid`, `email`, `profile`) |
| Supabase → Authentication → Providers → Google | habilitar, com o Client ID e o Client Secret do item acima (o secret vive só ali — nunca em repositório, bundle ou documento) |
| Supabase → Authentication → URL Configuration | **Site URL** `https://playkingcards.com.br` e **Redirect URL** `https://playkingcards.com.br/?conta=google` — é para cá que o Supabase devolve o jogador |
| Supabase → Authentication → Providers | **Enable Manual Linking**, exigido pelo SDK para `linkIdentity`/`unlinkIdentity` |
| Vercel (Production) | `VITE_KING_GOOGLE_LINK=1` — e só depois de tudo acima estar de pé |

### Validação real do Google linking — 24/09/2026

Feita na **Production real** (`playkingcards.com.br`), com o Google Auth Platform em **Testing** e
um único usuário de teste. O que ficou provado, no ar:

| O que se mediu | Resultado |
|---|---|
| Operação usada | `linkIdentity` — o convidado existente recebeu uma identidade nova, nenhum usuário foi criado |
| Mesmo `auth.users.id` antes e depois | **confirmado pela trava interna** (o retorno compara quem saiu com quem voltou e fecha se divergir) |
| Provider Google no usuário | presente, no **mesmo** usuário |
| Sessão | deixou de ser anônima |
| URL do callback | voltou **limpa** — sem `code`, sem `sb_flow_id`, sem marcador |
| JWT depois do vínculo | **aceito** pelo servidor em identidade permanente |
| Sala real criada depois do vínculo | sim, e sem 4004/4005 |
| UI | a Home passou a mostrar "Google conectado" |

**Nada disto libera o recurso.** O rollout público **continua desligado**, e o motivo é de produto,
não técnico: enquanto o app do Google está em *Testing*, só a conta de teste atravessa o
consentimento — um botão que funciona para uma pessoa e falha para todas as outras é pior do que
botão nenhum. O vínculo já feito **permanece** no Supabase; o que sai é só a interface.

O interruptor é `VITE_KING_GOOGLE_LINK` (ver `vinculoDeContaLigado()`): o recurso só acende com
`1` ou `true` **e** identidade configurada. **Ausência da variável é OFF**, e foi assim que ela
foi recolhida da Production — nenhuma linha de código mudou para isso. Religar é devolver a
variável e publicar o mesmo SHA de novo.

Para a liberação pública faltará, fora do repositório: publicar o app no Google (sair de
*Testing*), ou acrescentar os usuários previstos como testadores.


---

## 3. Inventário de dados

### 3.1 O que passou a existir com esta fase

| Dado | Onde vive | Classificação | Observação |
|---|---|---|---|
| `auth.users.id` (= `playerId`) | Supabase Auth + `players.id` | **PERSISTENTE · PÚBLICO** | Já era público antes: o `playerId` sempre esteve no estado sincronizado da sala. O que mudou é que agora ele **sobrevive** à sala |
| `provider` (`guest`/`google`/`apple`) | claim do JWT | **TRANSITÓRIO · PRIVADO** | Lido a cada entrada, nunca gravado. O servidor não persiste de onde a pessoa veio |
| `is_anonymous` | claim do JWT | **TRANSITÓRIO · PRIVADO** | idem |
| `display_name` | `players.display_name` | **PERSISTENTE · PÚBLICO** | É o apelido que os outros três já veem na mesa. Máx. 14 caracteres |
| `avatar_id` | `players.avatar_id` | **PERSISTENTE · PÚBLICO** | Preferência, não identidade — a exclusividade por mesa é decidida na sala |
| `created_at` / `updated_at` | `players` | **PERSISTENTE · PRIVADO** | Só o dono lê (RLS) |
| `access_token` (JWT) | `localStorage` do aparelho + memória do servidor durante a verificação | **TRANSITÓRIO · PRIVADO** | Nunca gravado em banco. **Nunca registrado em log** — só o motivo da recusa |
| `refresh_token` | `localStorage`, gerido pelo SDK | **TRANSITÓRIO · PRIVADO** | idem |
| `recoveryToken` | memória do servidor + cliente | **TRANSITÓRIO · PRIVADO** | Credencial ao portador com alcance de UMA sala. Morre com ela |
| Endereço de e-mail | Supabase Auth, **só quando houver OAuth real** | **PERSISTENTE · PRIVADO** | **Ainda não existe.** Convidado anônimo não tem e-mail. Entra no portão do Google |

### 3.2 O que esta fase deliberadamente NÃO introduziu

Nenhum dado de comportamento, progresso ou monetização: sem xp, nível, streak, conquista,
ranking, inventário, cosmético, histórico de partidas, telemetria nova ou identificador de
publicidade. A tabela `players` tem cinco colunas e é essa a lista inteira.

### 3.3 Quem consegue ler o quê

- **Outros jogadores:** apelido e avatar, dentro da sala — como já era antes desta fase.
- **O próprio jogador:** a linha inteira dele em `players`, e só ela. RLS por `auth.uid() = id`.
- **Qualquer outra pessoa:** nada. Sem sessão, o RLS nega.
- **O servidor Colyseus:** nunca lê o banco. Ele só **confere assinaturas**, com a chave pública
  do emissor. Não tem, e não precisa ter, nenhuma credencial do Supabase.

### 3.4 Exclusão

`players.id` tem `ON DELETE CASCADE` sobre `auth.users`: apagar a conta apaga o perfil.

**Não há política de DELETE no RLS** — sem política, o RLS nega por padrão, então o jogador não
apaga o próprio perfil pela API do cliente. Isso é deliberado, e é uma pendência declarada:
exclusão de conta precisa de fluxo próprio (confirmação, efeito sobre partidas em andamento,
prazo de arrependimento), e esse fluxo entra junto com a Política de Privacidade — não antes.

### 3.5 Segredos

Nunca no pacote Web nem no APK: `service_role`, `sb_secret_…`, JWT secret, senha do banco,
client secret de OAuth. Nenhum deles existe em nenhum arquivo deste repositório.

O que vai no pacote é público por desenho: a URL do projeto e a chave publicável, que identifica
o projeto e **não autoriza nada sozinha** — quem autoriza é a RLS, avaliada no servidor a cada
consulta.

### 3.6 Base para os formulários das lojas

O que está acima já responde, para **Google Data Safety** e **Apple App Privacy**, na configuração
de hoje (convidado anônimo, sem OAuth):

- **Coleta:** identificador de usuário, apelido, preferência de avatar.
- **Finalidade:** funcionamento do aplicativo (identificar o jogador entre sessões). Não há
  publicidade, não há analytics de terceiros, não há corretagem de dados.
- **Compartilhamento com terceiros:** nenhum, além do provedor de autenticação e da hospedagem.
- **Criptografia em trânsito:** sim, em tudo — `wss://` para o jogo, `https://` exigido para o
  provedor de identidade ([validado em código](../apps/web/src/auth/identidade.ts)).
- **Exclusão de conta:** fluxo pendente (ver 3.4). **A Apple exige que ele exista** para
  aplicativos que criam conta — inclusive conta de convidado. É P0 de publicação na App Store.

Quando o Google entrar, acrescenta-se **endereço de e-mail** à coleta, com a mesma finalidade.
