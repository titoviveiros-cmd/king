# KING — requisitos de publicação

Levantamento do que as lojas exigem e do que o KING **de fato** faz hoje. Não é texto jurídico:
é o inventário e a estrutura para que alguém com competência para isso escreva o texto final.

> ⚠️ **Nada aqui é redação definitiva de Política de Privacidade.** Os trechos marcados como
> *rascunho* existem para mostrar a forma e o conteúdo esperados, e precisam de validação antes
> de virar página pública.

---

## 1. O que o KING coleta, de verdade

Levantado do código, não de memória. Cada linha abaixo é rastreável a um arquivo.

| Dado | Onde vive | Sai do aparelho? | É PII? |
|---|---|---|---|
| **Apelido** (até 14 caracteres, digitado) | estado da sala no servidor, em memória | Sim — os outros 3 da mesa veem | **Potencialmente sim**: a pessoa pode digitar o nome real |
| **Avatar** (1 de 8 etiquetas fechadas) | estado da sala + `localStorage` `king:avatar` | Sim — os outros veem | Não |
| **Código da sala** (4 dígitos) | gerado pelo servidor, em memória | Sim — quem entra digita | Não, mas é **credencial de acesso** à partida |
| **`recoveryToken`** | `localStorage` + memória do servidor | Só entre o dono e o servidor | Não, mas é **segredo** |
| **Progresso do tutorial** | `localStorage` `king:tutorial` | Não | Não |
| **Preferências de áudio** | `localStorage` `king.audio` | Não | Não |
| **Mensagens sociais** | etiqueta de conjunto fechado, efêmera | Sim — a etiqueta, nunca texto livre | Não |
| **Eventos de analytics** | camada neutra, hoje **sem destino** | **Não** (adaptador silencioso) | Não — `sanitizar` derruba apelido, código de sala e texto livre |

**Não existe:** conta, login, e-mail, senha, telefone, endereço, localização, contatos,
identificador de publicidade, câmera, microfone, notificações push, compras.

**Nada é persistido em banco.** O servidor guarda o estado da sala **em memória**; sala encerrada,
dado evaporou. Não há banco de dados no projeto.

### O ponto sensível: o apelido

É o único campo de texto livre que viaja. Uma pessoa pode digitar "Tito Viveiros". Três decisões
a tomar antes de publicar:

1. Declarar o apelido como dado pessoal opcional fornecido pela própria pessoa? (**recomendado**)
2. Limitar a exibição do apelido só à sala em que foi digitado? (**já é o caso hoje**)
3. Deixar explícito na tela que o apelido aparece para as outras pessoas da mesa?
   (**não está hoje** — o placeholder diz "Como aparecer na mesa", o que ajuda mas não é aviso)

---

## 2. URLs públicas que as lojas exigem

Domínio já existente: `playkingcards.com.br`.

| Página | Exigida por | Situação | Sugestão de URL |
|---|---|---|---|
| **Política de Privacidade** | App Store **e** Google Play (obrigatória, URL pública, fora da loja) | 🔴 não existe | `playkingcards.com.br/privacidade` |
| **Suporte** | App Store (campo "Support URL" é obrigatório) | 🔴 não existe | `playkingcards.com.br/suporte` |
| **Termos de Uso** | Não obrigatória; recomendada | 🔴 não existe | `playkingcards.com.br/termos` |
| **Exclusão de conta/dados** | Google Play exige quando há conta | ⚪ não se aplica — **não há conta** | — |
| **Marketing / página do app** | opcional | ⚪ opcional | `playkingcards.com.br` |

As três primeiras precisam responder HTTP 200, sem login, e ficar no ar **antes** da submissão.

---

## 3. Estrutura da Política de Privacidade

Seções que precisam existir, com o conteúdo que o KING realmente tem:

1. **Quem somos e como falar conosco** — responsável e e-mail de contato. *(falta definir)*
2. **O que coletamos** — a tabela da seção 1, em linguagem simples.
3. **Por que coletamos** — apelido e avatar existem para os outros jogadores identificarem quem é
   quem; o código da sala existe para entrar na partida certa. Nada é usado para publicidade.
4. **O que NÃO coletamos** — a lista da seção 1. É a parte mais curta e a mais tranquilizadora.
5. **Onde os dados ficam e por quanto tempo** — em memória no servidor, apagados ao fim da sala;
   preferências ficam **no aparelho**, e desinstalar o app as apaga.
6. **Com quem compartilhamos** — hoje, ninguém. Sem analytics contratado, sem publicidade, sem
   redes sociais. *(Se um fornecedor de métricas entrar, esta seção muda e a política precisa ser
   republicada ANTES.)*
7. **Crianças** — decisão pendente de classificação etária (seção 5).
8. **Direitos do titular (LGPD)** — como pedir acesso/exclusão. Simples aqui: não há conta, e o
   que existe é local ao aparelho.
9. **Alterações** — data da última atualização.

> *Rascunho de tom, não de texto final:* "O KING não pede cadastro, não pede e-mail e não sabe
> quem você é. Para jogar com amigos, você escolhe um apelido e um avatar — e eles aparecem só
> para as pessoas da sua mesa, enquanto a partida durar."

---

## 4. Página de Suporte — conteúdo mínimo

- e-mail de contato que alguém realmente leia *(falta definir)*;
- "como jogar" (pode apontar para o próprio APRENDA KING dentro do app);
- problemas comuns: não consigo entrar na sala; caí no meio da partida; não tem som;
- como relatar um erro;
- link para a Política de Privacidade.

---

## 5. Decisões que faltam — e são suas

| # | Decisão | Por que trava |
|---|---|---|
| 1 | **E-mail de contato/suporte** | Vai impresso na loja e na política. Sem ele, nenhuma das duas páginas fecha. |
| 2 | **Titular** (pessoa física ou CNPJ) | Define quem assina a política e quem publica na loja. Google Play exige conta de desenvolvedor verificada. |
| 3 | **Classificação etária** | KING é jogo de cartas sem aposta, sem dinheiro, sem chat livre — perfil de classificação baixa. Precisa ser respondido no questionário de cada loja. |
| 4 | **Fornecedor de métricas** | Se entrar algum, a política precisa dizer antes de o app coletar. |
| 5 | **Onde hospedar as três páginas** | O domínio já existe e a Vercel já serve o app; rotas estáticas resolvem. |

---

## 6. Checklist técnico de loja

| Item | Situação |
|---|---|
| `appId` / bundle id | 🟢 `br.com.playkingcards.king` |
| Nome do app | 🟢 KING |
| Orientação landscape travada | 🟢 aplicada por `npm run mobile:preparar` (iOS e Android) |
| Safe areas / notch / Dynamic Island | 🟢 `viewport-fit=cover` + `env(safe-area-inset-*)` |
| WSS em iOS (ATS) e Android (cleartext) | 🟢 TLS válido; nenhuma exceção necessária |
| CORS a partir de origem nativa | 🟢 medido: `capacitor://localhost`, `http://localhost`, `ionic://localhost` |
| **Ícone do app** | 🔴 não existe |
| **Splash screen** | 🔴 não existe |
| Versão / build number | 🔴 não definidos |
| Assinatura (keystore Android, certificados Apple) | 🔴 não configurada |
| Capturas de tela de loja | 🔴 não existem |
| Descrição e palavras-chave | 🔴 não existem |
| Conta de desenvolvedor (Apple US$ 99/ano, Google US$ 25) | ⚪ desconhecida |
| **Máquina macOS para compilar iOS** | 🔴 não existe — este projeto vive no Windows |
| Captura de erro/crash em produção | 🔴 não existe (ver seção 7) |

---

## 7. Error/crash reporting — recomendação

**Recomendo adotar antes de publicar, e recomendo NÃO adotar agora.**

O motivo de adotar: hoje, se o app quebrar na mão de alguém, não existe absolutamente nenhum
sinal. Não há log de cliente, não há captura de exceção, não há relatório. Numa loja, o primeiro
retorno seria uma avaliação de uma estrela dizendo "trava" — sem stack, sem versão, sem aparelho.

O motivo de não ser agora: escolher fornecedor é decisão de **dados pessoais e infraestrutura**,
que é exatamente o tipo de coisa que o combinado manda parar e perguntar. Captura de erro envia
stack traces, e stack trace pode carregar conteúdo de estado.

Quando for a hora, o caminho já está preparado: a camada `analytics` tem adaptador trocável, e um
`Adaptador` de erros segue a mesma forma. As perguntas a responder serão:

1. auto-hospedado (GlitchTip) ou serviço (Sentry, Firebase Crashlytics)?
2. o que pode ir junto do erro — só stack e versão, ou também estado de partida?
3. taxa de amostragem e retenção;
4. a política de privacidade precisa mencioná-lo **antes** de a primeira captura acontecer.

---

## 8. Vulnerabilidades de dependência

Ver a auditoria completa na entrega da rodada. Resumo: **12 alertas, nenhum explorável no KING**.
Todos vivem em ferramenta de desenvolvimento (Vitest, Vite/esbuild) ou em submódulos do Colyseus
(`@colyseus/auth`, `@colyseus/playground`) que são carregados mas **não montados** — medido em
produção, local e na VPS: `/playground`, `/auth` e `/auth/providers` respondem **404**.

As correções oferecidas pelo `npm audit` são todas **major**, e uma delas (`colyseus@0.15`) é um
**downgrade** que quebraria o servidor. Nenhuma foi aplicada. Nenhuma é blocker de publicação.
