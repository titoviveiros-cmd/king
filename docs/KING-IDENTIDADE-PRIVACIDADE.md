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
