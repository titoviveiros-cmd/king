# KING — prontidão para publicação

O que as lojas exigem, o que o KING **de fato** faz, e o que falta. Levantado do código e de
execuções reais, não de memória.

> ⚠️ **Nada aqui é redação jurídica.** Os trechos marcados como *rascunho* mostram forma e
> conteúdo esperados e precisam de validação antes de virar página pública.

---

## 1. O que o KING coleta, de verdade

| Dado | Onde vive | Sai do aparelho? | É PII? |
|---|---|---|---|
| **Apelido** (até 14 caracteres, digitado) | estado da sala no servidor, em memória | Sim — os outros 3 da mesa veem | **Potencialmente sim**: a pessoa pode digitar o nome real |
| **Avatar** (1 de 8 etiquetas fechadas) | estado da sala + `localStorage` `king:avatar` | Sim — os outros veem | Não |
| **Código da sala** (4 dígitos) | gerado pelo servidor, em memória | Sim — quem entra digita | Não, mas é **credencial de acesso** |
| **`recoveryToken`** | `localStorage` + memória do servidor | Só entre o dono e o servidor | Não, mas é **segredo** |
| **Progresso do tutorial** | `localStorage` `king:tutorial` | Não | Não |
| **Preferências de áudio** | `localStorage` `king.audio` | Não | Não |
| **Mensagens sociais** | etiqueta de conjunto fechado, efêmera | Sim — a etiqueta, nunca texto livre | Não |
| **Eventos de analytics** | camada neutra, hoje **sem destino** | **Não** (adaptador silencioso) | Não — `sanitizar` derruba apelido, código de sala e texto livre |

**Não existe:** conta, login, e-mail, senha, telefone, endereço, localização, contatos,
identificador de publicidade, câmera, microfone, notificações push, compras.

**Nada é persistido em banco.** O servidor guarda o estado da sala **em memória**; sala encerrada,
dado evaporou. Não há banco de dados no projeto.

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
| **Política de privacidade (URL)** | obrigatória | obrigatória | 🔴 ausente | **P0** | e-mail + titular | §6 |
| **Suporte (URL)** | recomendada | **obrigatória** | 🔴 ausente | **P0** | e-mail | §6 |
| **Termos (URL)** | opcional | opcional | 🔴 ausente | não | titular | §6 |
| **Classificação etária** | questionário | questionário | ⚪ não respondido | **P0** | titular | §6 |
| **Declarações de privacidade da loja** | Data Safety | Privacy Nutrition Labels | ⚪ não preenchido | **P0** | §1 responde | preencher |
| **Capturas de tela** | phone + tablet | iPhone + iPad | 🔴 ausentes | **P0** | arte | depois dos avatares |
| **Analytics** | neutro, sem destino | idem | 🟢 não bloqueia | não | — | §7 |
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
| **Política de Privacidade** | App Store **e** Google Play | 🔴 não existe | `/privacidade` |
| **Suporte** | App Store (campo obrigatório) | 🔴 não existe | `/suporte` |
| **Termos de Uso** | recomendada | 🔴 não existe | `/termos` |
| **Exclusão de conta/dados** | Google Play, quando há conta | ⚪ não se aplica — **não há conta** | — |

As três primeiras precisam responder HTTP 200, sem login, **antes** da submissão.

### Estrutura da Política de Privacidade

1. **Quem somos e como falar conosco** — responsável e e-mail. *(falta)*
2. **O que coletamos** — a tabela da §1, em linguagem simples.
3. **Por que** — apelido e avatar existem para os outros jogadores saberem quem é quem; o código
   da sala existe para entrar na partida certa. Nada é usado para publicidade.
4. **O que NÃO coletamos** — a lista da §1. A seção mais curta e a mais tranquilizadora.
5. **Onde ficam e por quanto tempo** — em memória no servidor, apagados ao fim da sala;
   preferências ficam **no aparelho** e somem ao desinstalar.
6. **Com quem compartilhamos** — hoje, ninguém. *(Se entrar métrica ou captura de erro, esta
   seção muda e a política precisa ser republicada ANTES.)*
7. **Crianças** — depende da classificação etária.
8. **Direitos do titular (LGPD)** — simples: não há conta, e o que existe é local ao aparelho.
9. **Alterações** — data da última atualização.

> *Rascunho de tom, não de texto final:* "O KING não pede cadastro, não pede e-mail e não sabe
> quem você é. Para jogar com amigos, você escolhe um apelido e um avatar — e eles aparecem só
> para as pessoas da sua mesa, enquanto a partida durar."

### Página de Suporte — conteúdo mínimo

e-mail que alguém leia *(falta)* · como jogar (apontar para o APRENDA KING) · problemas comuns
(não entro na sala, caí no meio da partida, não tem som) · como relatar erro · link para a
privacidade.

### ⏸️ Decisões que dependem de você

| # | Decisão | O que trava |
|---|---|---|
| 1 | **E-mail de contato/suporte** | as três páginas e a ficha da loja |
| 2 | **Titular** (pessoa física ou CNPJ) | quem assina a política e publica; Google Play exige conta verificada |
| 3 | **Classificação etária** | KING é jogo de cartas sem aposta, sem dinheiro e **sem chat livre** — perfil de classificação baixa, mas o questionário é por loja |
| 4 | **Bundle identifier definitivo** | ver §4 |
| 5 | **Contas de desenvolvedor** | assinatura e envio |

---

## 7. Analytics e error monitoring

**Analytics** continua **vendor-neutral com adaptador silencioso**. Nada sai do aparelho. A
arquitetura não depende de navegador nem de rede: `track()` não devolve promessa, envolve o
adaptador em `try/catch` e o padrão é o silêncio — então **no build Capacitor o comportamento é
idêntico ao da Web**, inclusive com adaptador ausente. Coberto por 29 testes.

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
| **Tutorial abre na 1ª execução** | 🟡 esperado, não verificado no WebView | usa `localStorage`, que existe nos dois WebViews; mesma persistência da Web |
| **Não entra em loop** | 🟢 coberto por Playwright | `deveAbrirSozinho` só é verdade uma vez |
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

## 11. Vulnerabilidades de dependência

**12 alertas, nenhum explorável no KING.** Todos vivem em ferramenta de desenvolvimento (Vitest,
Vite/esbuild) ou em submódulos do Colyseus (`@colyseus/auth`, `@colyseus/playground`) que são
carregados mas **não montados** — medido em produção, local e na VPS: `/playground`, `/auth` e
`/auth/providers` respondem **404**.

As correções oferecidas pelo `npm audit` são todas **major**, e uma (`colyseus@0.15`) é um
**downgrade** que quebraria o servidor. Nenhuma foi aplicada. Nenhuma é blocker de publicação.
Débito de manutenção agendável, não urgência.
