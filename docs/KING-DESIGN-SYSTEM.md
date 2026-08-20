# KING — Design System (direção oficial)

> Consolida a direção visual **congelada** do KING, derivada do DNA da família (ver
> [VERBETE-GAME-DNA.md](VERBETE-GAME-DNA.md)). **A Home será a fonte de verdade** que congela os
> valores exatos (hex/oklch, escalas, espaçamentos) — este documento fixa a *direção*, não os
> pixels finais. Nada aqui autoriza implementar Home/mesa/personagem definitivos sem validação.

## Estado do milestone — FECHADO ✅ (2026-08-19)
Marco de encerramento do **primeiro milestone jogável do KING**. A **branch `main` é a BASE
OFICIAL** do projeto a partir deste ponto.

| Item | Estado |
|---|---|
| Rule Engine / checksums (−1300 / +1300 / 0) | ✅ |
| Home | ✅ congelada |
| Lobby | ✅ oficial |
| Mesa | ✅ arquitetura congelada |
| Placar entre-mãos | ✅ componente congelado |
| Placar Final | ✅ componente congelado |
| Áudio procedural + haptics | ✅ validado em **iPhone real** |
| Responsividade | ✅ validada em **aparelhos/tamanhos reais** |
| Regressão `ranking × seat` | ✅ coberta por teste (`placarFinalDados.test.ts`) |
| Suíte de testes | ✅ **76 verdes** (64 motor + 12 web) |

> A partir deste marco, **todo novo milestone nasce em nova feature branch** criada a partir
> desta `main` congelada. **Fora deste fechamento** (não implementados ainda): Bot Normal V1,
> CI, Playwright, deploy, multiplayer, persistência.

## Tipografia — CONGELADA ✅
- **Display — Gabarito** (arredondada, encorpada, contemporânea; premium sem ser infantil).
  Usos: títulos, **contratos**, botões, placar, números grandes, HUD. Pesos **700/800**,
  frequentemente **CAIXA ALTA**. Tratamento "nobre" via espaçamento, sombra, glow controlado e
  degradê **Ouro Coroa** — sem cair em medieval/cassino.
- **Corpo — Nunito** (UI, tutorial, nomes, textos funcionais, legendas). Pesos **400/700**.
  Excelente legibilidade em telas pequenas; mantém o parentesco com o Verbete.
- **Números:** `font-variant-numeric: tabular-nums` no placar (colunas alinhadas).
- Ambas são open-source (disponíveis via `@fontsource` / Google Fonts) — embutir na build.
- **Proibido:** serifa (Georgia) e cópia direta de Fredoka/Baloo.

## Logo — direção aprovada (arte final à parte) ✅
- **Lettering próprio + coroa**, **independente** da fonte de interface — assinatura icônica,
  premium, majestosa. A **coroa isolada** funciona como app-icon (como o "V" do Verbete).
- Gabarito serve só de rascunho; o lettering final será desenhado à mão e **aprovado à parte**.

## Paleta — núcleo confirmado ✅
| Papel | Cor | Uso |
|---|---|---|
| **Noite Imperial** | roxo-noite profundo | fundo/mesa (telas de jogo escuras) |
| **Roxo Real** | roxo base da marca | superfícies, base |
| **Violeta Glow** | violeta luminoso | luz/destaque/glow |
| **Ouro Coroa** | dourado | **comedido:** marca/coroa, liderança, vitória, 1º, conquistas, CTAs relevantes |
| **Turquesa/Menta** *(complementar)* | turquesa | **semântica de positivo** |

### Cor semântica (herdada do Verbete, adaptada)
- **Turquesa** = positivo / sucesso / confirmação / conexão / **fase positiva** — sem dominar,
  sem pintar em excesso todas as cartas legais.
- **Magenta/Rosa** = tensão / perigo / **King (K♥)**.
- **Ouro** = marca / recompensa / liderança — comedido.
- **Roxo** = base neutra.

## Profundidade, botões e superfícies (herdado, adaptado)
- **Botão "candy" 3D:** aresta inferior dura + afundamento no toque (`active:translate-y`),
  borda clara, display em caixa alta. É a peça de UI assinatura.
- **Sombra pop** (pseudo-3D) + **glow controlado**; cantos muito arredondados; cards com relevo.
- Superfícies premium/metálicas nos momentos imperiais; vidro fosco em tiles secundários.

## Movimento (primitivos herdados)
- **pop-in** (entrada com mola/overshoot), **float-idle** (cartas/HUD/"O Rei" vivos),
  **screen-shake + flash** para momentos heróicos (**King capturado**, última vaza, virada),
  **stagger** na distribuição das 13 cartas, **confetti** na vitória. Respeitar `prefers-reduced-motion`.

## Áudio & haptics — ✅ implementado (`apps/web/src/audio`)
Engine **procedural** (Web Audio, **zero assets**) + haptics semânticos, reaproveitada do Verbete
e adaptada ao KING. `engine.ts` = cadeia de sinal e primitivas; `sounds.ts` = **eventos do jogo**,
um por função.

**Cadeia de sinal** (é o que separa "bipe" de som de produto):
```
efeitos ──┬──────────────────────────► sfxBus ──┐
          └─ send ─► convolver (reverb) ──────┐ │
música  ──┬──────────────────────────► musBus ─┼─┼─► compressor ─► master ─► saída
          └─ send ─► convolver (reverb) ──────┘ │
```
- **Reverb por convolução** com resposta impulsiva **gerada em runtime** (ruído com decaimento
  exponencial, 2,4s, estéreo, pré-atraso de 12ms + amortecimento em 3,2kHz). Cada som declara
  quanto envia (`space`): eventos íntimos ficam perto, momentos heróicos ficam grandes e distantes.
- **Compressor/limitador** no master (−15dB, ratio 3,2): King capturado + música + carta jogada
  simultâneos não estouram.
- **Envelope com corpo** (ataque → sustentação → decaimento) em vez de decaimento imediato.
- Ondas cruas (`square`/`sawtooth`) **sempre** com passa-baixa — sem isso o som fica estridente.
- **Música:** Ré menor, i–VI–III–v, 6,4s por acorde; cada nota são **dois osciladores
  desafinados** (o batimento entre eles é o corpo) + grave de sustentação; reverb generoso.
  É colchão de mesa, não trilha.
- **Volume independente** de Música e Efeitos (0–100%), além do liga/desliga.

| Evento | Som |
|---|---|
| Distribuição | stagger de 8 sopros curtos |
| Carta jogada | sopro de papel + clique seco |
| Carta selecionada (toque) | tom curto + vibração leve |
| Vaza boa (positiva sua / negativa que escapou) | tríade ascendente (turquesa) |
| Penalidade sua | queda de meio tom + ruído grave |
| **King capturado (K♥)** | impacto grave + dissonância + **screen-shake e flash magenta** |
| Trunfo confirmado | 3 primeiras notas do **motivo da coroa** |
| Última vaza | riser de tensão |
| Fim de mão · vitória · derrota | resolução · **motivo da coroa** completo · cadência sóbria |

- **Motivo da coroa:** Ré–Lá–Fá♯–Ré (arpejo maior) — assinatura sonora do KING.
- **Música ambiente (bossa):** Ré maior, I–vi–ii–V, 2s por compasso; violão sincopado na grade de
  semicolcheias, baixo com a célula pontuada e ganzá nas colcheias. Ducking automático nos efeitos.
- **Comemoração do campeão:** a MESMA harmonia acelerada (1,5s por compasso), com levada mais
  densa, palmas nos tempos 2 e 4 e **melodia** — o 1º compasso é o motivo da coroa. Entra na
  coroação do Placar Final e sai quando a tela fecha.
- **Controles separados** (Música / Efeitos / Vibração) + **sliders de volume**, sempre
  desligáveis, **salvos no aparelho**.
  Desligado = **nenhum nó de áudio é criado**, não é só volume zero.
- **iOS:** o contexto é liberado no 1º toque real ("Jogar agora"). A Vibration API **não existe**
  no Safari/iOS — o controle aparece desabilitado e explicado, sem prometer o que não entrega.

## Responsividade e aparelhos — ✅ implementado
Nenhum número de layout é fixo: **toda a geometria da mesa deriva de `--handcw`** (a carta do
leque), que é `clamp(32px, min(6.6vw, 13vh), 74px)`. Largura do leque, passo entre cartas, ângulo
do arco, vaza central, HUD, avatares e Placar saem daí ou de `clamp()` em `vh/vw`.
- **Safe areas** (`env(safe-area-inset-*)`) em HUD, botões de topo, avatares laterais e leque —
  nada fica sob o notch/Dynamic Island nem sob a barra inferior do iPhone.
- **Retrato** mostra **"GIRE O APARELHO"** — mas **só em aparelho de toque**. Numa janela alta
  e estreita de PC o layout se adapta sozinho; pedir rotação de monitor seria absurdo.
- **Altura real:** `--vh` = `1dvh` onde existe, `1vh` como reserva. No Android o `vh` ignora a
  barra do Chrome e as cartas ficariam maiores que o espaço visível.
  > Houve uma versão que escrevia `--vh` por JS a partir de `visualViewport`. **Removida**:
  > dependia de eventos de resize que nem sempre chegam e, quando não chegavam, o valor
  > **congelava** — a mesa continuava dimensionada para uma tela anterior. `dvh` acompanha
  > sozinho, sem evento.

### Corredores e distâncias mínimas
A mesa reserva faixas onde o leque nunca entra e mantém a vaza entre o card do topo e o leque.
Medições com 13 cartas e vaza cheia (todas as folgas em px, todas positivas):

| Tela | Carta | Seu card → leque | Topo → vaza | Vaza → leque | Leque → base |
|---|---|---|---|---|---|
| 667×375 | 47 | 23 | 28 | 46 | 9 |
| 800×360 | 56 | 53 | 8 | 12 | 10 |
| 852×393 | 60 | 63 | 19 | 18 | 10 |
| 874×402 | 61 | 65 | 21 | 18 | 10 |
| 956×440 | 67 | 71 | 27 | 20 | 10 |
| 1024×768 | 72 | 59 | 148 | 167 | 15 |
| 1600×900 | 96 | 222 | 164 | 162 | 17 |

Duas armadilhas que já causaram sobreposição real e viraram regra:
1. **A carta da ponta é girada 13,8°** — o canto dela avança além da caixa de layout. O
   `--corredor` precisa contar com essa sobra, não só com a largura nominal do leque.
2. **A vaza fica entre dois vizinhos apertados** (card do topo e leque). Qualquer mudança em
   `--trickcw` ou no `top` da `.trick` precisa ser remedida nas telas baixas (360–402px).

### Escala tipográfica — `--ui`
Toda a interface da mesa (HUD, cards dos jogadores, slot de trunfo, avisos) e os dois Placares
derivam de **uma única unidade**: `--ui: clamp(12.5px, min(1.6vw, 3.2vh), 19px)`. Antes cada
texto tinha o seu próprio `clamp` e, numa tela de 402px de altura, **todos** caíam no mínimo —
por isso a informação ficava miúda. Mexer em `--ui` reescala a mesa inteira de forma proporcional.

| Elemento | Múltiplo de `--ui` | No iPhone deitado |
|---|---|---|
| Contrato (HUD) | 1.42 | 18,3px |
| Fase (eyebrow) | 0.78 | 10,0px |
| Penalidade | 0.98 | 12,6px |
| Nome do jogador | 1.08 | 13,9px |
| Cartas/pontos do jogador | 0.90 | 11,6px |
| Avatar | 2.50 | 32px |
| Naipe do trunfo | 2.90 | 37,3px |

A **carta do leque** é `clamp(38px, min(7vw, 15.5·--vh), 96px)` — 61px no iPhone deitado. O leque
respeita um **corredor lateral** (`--corredor`) para nunca encostar no seu card nem no aviso de
confirmação; quando falta espaço, quem encolhe é o passo entre cartas, não a carta.

### Estados da carta no leque
- **Jogável:** sombra funda (`.13·largura` de deslocamento), aro turquesa e brilho — a carta
  descola da mesa.
- **Ilegal:** achatada de propósito (`0 1px 3px`) e dessaturada. O contraste entre as duas é o
  que guia a escolha, não a cor sozinha.
- **K♥ jogável:** mesma elevação, com aro dourado no lugar do turquesa.

### Por tipo de aparelho
| | Entrada | Comportamento |
|---|---|---|
| **Celular / tablet** (`pointer: coarse`) | 1º toque **seleciona** (estado `selecionada` do DS), 2º **joga** | aviso de rotação em retrato; sem hover |
| **PC** (`pointer: fine`) | clique joga direto; **← →** escolhe entre as cartas **legais**, **Enter/Espaço** joga, **1–5** escolhe o trunfo, **Esc** fecha o painel | dica de atalhos visível, `:focus-visible` dourado, hover ativo |
| **Android** | **Voltar** sai da mesa para a Home (não abandona a página); **tela cheia** com trava de orientação landscape; vibração funcional | |
| **iPhone** | idem celular | sem botão de tela cheia (Safari/iOS não expõe a API) e sem vibração |

- **Medições reais:** ✅ 874×402 (iPhone 17 deitado) · ✅ 667×375 (iPhone pequeno) ·
  ✅ 1024×768 (iPad) · ✅ 1600×900 (PC) · ✅ 800×1000 (janela de PC em retrato) ·
  ✅ 740×400 e 375×812 (Android emulado) — sem rolagem horizontal, 13 cartas acessíveis,
  Placar inteiro sem rolagem.

## Ritmo — tokens centralizados (decisão de auditoria)
Todos os tempos da apresentação vivem em `apps/web/src/game/timings.ts`. **Não existe opção de
velocidade para o jogador** — quando existir ("Animações rápidas"), será um multiplicador sobre
estes valores e **nunca** tocará em regra: o motor é síncrono e não conhece tempo.

| Token | Valor | Papel |
|---|---|---|
| `botPasso` | 520ms | intervalo entre passos dos bots (era 620) |
| `leituraDaVaza` | 1150ms | pausa para ler a vaza resolvida (era 1300) |
| `chipSuaVez` | 2200ms | permanência do chip "Sua vez" |
| `shakeKing` | 520ms | screen-shake do K de Copas |
| `fim.*` | 900 / 2350 / 3300 / 4300ms | marcos do Placar Final |

A calibragem reduziu a partida contra bots de ~8 para ~6,5 minutos sem prejudicar a leitura da
vaza. Os valores de CSS que acompanham estes estão marcados com `// par de TEMPOS.fim`.

## Orientação
- **Gameplay em Landscape** (necessidade das 13 cartas + 4 jogadores). Home/menus podem ser
  portrait-friendly; a mesa é landscape.

## Personagem "O Rei" — CONGELADO ✅ (propriedade visual oficial)
Base: híbrido **B (Estrategista) × A (Carismático)**. Personalidade oficial:
**Sagaz + Confiante + Caloroso + Leve ironia**, adulto contemporâneo, acessível.
Traços congelados:
- **Rosto:** barbeado (sem barba/cavanhaque), formato angular, **olhos calorosos** (tamanho fixo —
  não aumentar/infantilizar), **sobrancelha sagaz**, **meio-sorriso**.
- **Traje próprio:** jaqueta contemporânea de **ombros estruturados**, **gola alta com recorte em
  "V"** (ecoa a coroa), **costura dourada integrada** à alfaiataria (NÃO dragona/militar), **fecho
  assimétrico**, **emblema KING** na gola. Silhueta com personalidade **mesmo sem a coroa**.
- **Coroa (símbolo do KING):** **recorte frontal em "V" + gema magenta**, geometria icônica;
  funciona isolada como app-icon, legível em tamanhos pequenos.
- **Estados emocionais** aprovados como direção: Anfitrião · Sagaz · Comemorando (+ tenso/derrota/
  orientando na folha completa da arte final).
- **Herança do Verbete:** arquitetura de **humores + float + reações** (não a forma do mascote-livro).

Status de arte: a versão **vetorial** é a **referência conceitual oficial**. A **produção final**
deverá receber **ilustração 2.5D premium** (materiais, iluminação, profundidade, acabamento) —
tarefa de arte posterior, com aprovação. Referência: artifact "O Rei — Conceito Oficial"
(https://claude.ai/code/artifact/1ecceea9-9ab6-4931-a5db-06bf9168f8d4).

## Fonte de verdade: HOME (congelada) ✅ + tokens consolidados
A **Home** é a **fonte oficial de verdade visual** do KING (artifact 69477d05-8a55-43b0-9faf-a0e94ee8e67c).
Toda tela nova deriva destes tokens/padrões.

### Cores (tema escuro / imperial — padrão)
`--night #140a24` · `--night2 #1c1038` · `--surface #241546` · `--surface2 #2d1a56` ·
`--violet #9b6cff` · `--purple #6d28d9` · `--gold #f4c542` · `--gold2 #c9971f` ·
`--magenta #e0338a` · `--turq #2dd4bf` · `--ink #f4eeff` · `--muted #c3b6de` ·
`--faint #9284b8` · `--line rgba(180,150,255,.18)`.
**Tema claro** redefine os mesmos tokens (fundo lilás claro, texto escuro, dourado mais fechado).

### Tipografia
Display **Gabarito** 700/800 (títulos/contratos/botões/números, caixa alta frequente); corpo
**Nunito** 400/700. Números com `tabular-nums`.

### Semântica de cor
Ouro = marca/CTA/vitória/1º (comedido) · Turquesa = positivo/sucesso/online (e ações "seguras"
em estilo *ghost*) · Magenta = tensão/King · Violeta/Roxo = secundário/base.

### Componentes
- **Botão candy** (assinatura): cantos 16px, borda clara, **aresta inferior dura** (`0 7px 0`),
  glow; `hover: translateY(-2px)+brilho`, `active: translateY(+2px)+aresta reduzida`.
  Variantes: **primário ouro** (`JOGAR AGORA`), **secundário violeta**, **ghost turquesa** (bots —
  discreto, não compete com o ouro).
- **Player card** (progressão orgânica, NÃO dashboard): avatar com **anel de XP** (conic-gradient
  ouro) + badge de nível + barra de XP (turquesa→violeta) + streak. Só o essencial na Home; stats
  completos no Perfil.
- **Tiles terciários** (Perfil/Conquistas/Config.): vidro `rgba(255,255,255,.15)`, borda violeta,
  presentes mas claramente abaixo das ações de jogo.
- **Frame / layout:** **LANDSCAPE em toda a app** (menus + gameplay — sem rotação). Device-frame
  16/9 arredondado (28px) com glow; **lado herói** (~43%: logo+coroa+tagline+O Rei) + **painel de
  ações** (~57%); empilha em telas estreitas.

### Motion (primitivos consolidados)
`floatIdle` (O Rei, translateY −10 + rot ±1°, ~4.6s) · `glowPulse` (respiração do logo/coroa) ·
`riseIn` stagger de entrada (`cubic-bezier(.34,1.4,.64,1)`, delays escalonados) · partículas muito
sutis no fundo + watermark de coroa · **hover/press** dos botões candy. Tudo respeita
`prefers-reduced-motion`.

### Regra de produto
**Nunca simular** contagem de usuários online — indicador social só com **dado real**; nada de
versão/infra técnica em rodapé público.

## Mesa — arquitetura visual oficial ✅ (congelada)
Vale para as **10 mãos**, variando só HUD, trunfo e feedbacks de contrato. Não redesenhar sem
motivo funcional comprovado. (Artifact eaf64375-0108-462b-bfa8-60c1b4875730.)
- **Layout landscape**: HUD do contrato (topo-esq, consolidado: fase·mão / contrato / penalidade·vaza),
  ícone de placar (topo-dir, sem lista textual permanente), 4 jogadores nas posições fixas
  (você inferior · esq · topo · dir), **vaza central** (4 slots ligados a cada jogador, Z-order =
  ordem de jogada), **leque de 13 cartas** inferior (protagonista). **Organização padrão da mão:**
  agrupada por naipe (cores alternadas ♠ ♥ ♣ ♦) e do **maior ao menor** (esq→dir); permanece
  ordenada ao jogar. (Ordenação por valor pode ser opção futura.)
- **Estados da carta**: `normal` · `jogável` (marca turquesa discreta) · `selecionada` (elevação
  −38px + escala 1.14 + endireita + anel dourado + sombra física) · `ilegal` (legível, dessaturada).
- **K♥**: identidade especial (borda dourada + 👑) para o dono; quando ilegal, a indisponibilidade
  **prevalece** (escurece) sem perder reconhecimento; nunca exposto aos adversários.
- **Turno**: anel+glow no avatar + glow de posição + pulso + "SUA VEZ" temporário (estado visual
  permanece após o texto sumir); mesmo mecanismo nos adversários.
- **Trunfo**: **inexistente nas mãos 1–6** (sem slot); nas 7–10 o slot aparece (♥/♦/♣/♠/Sem Trunfo).
- **Assinatura imperial** (reconhecível sem logo): iluminação de topo dourada, inlay de mesa,
  coroa/padrão quase imperceptível, reflexos violeta/dourado, partículas mínimas. **Sem feltro.**
- **Responsividade — checagem registrada:** ✅ 16:9, ✅ 19.5:9, ✅ 20:9 — em todas as 13 cartas
  permanecem acessíveis e valor/naipe legíveis; proporções mais alongadas dão mais folga ao leque.

## Nomenclatura das fases — ✅ oficial (definida pelo Tito)
| Mão | Nome nas regras / motor | Rótulo na Mesa e no Placar | Penalidade exibida |
|---|---|---|---|
| 1 | Não pegar vazas | **Não pegar Vazas** | −20 / vaza |
| 2 | Não pegar Copas | **Não pegar Copas** | −20 / copa |
| 3 | Não pegar Damas | **Não pegar Q** | −50 / dama |
| 4 | Não pegar Reis e Valetes | **Não pegar K e J** | −30 / homem |
| 5 | Não pegar o Rei de Copas | **Não pegar o K♥** | K♥ = −160 |
| 6 | Não pegar as duas últimas | **Não pegar as 2 últimas Vazas** | −90 na 12ª e na 13ª |
| 7–10 | Positiva | **Positiva — faça vazas** | +25 / vaza |

- Macro-fases: **Fase negativa** (1–6) e **Fase positiva** (7–10).
- **Sem emoji** nos títulos de contrato (a versão anterior usava ❤️/👸/👑♥).
- Os identificadores de código (`no-tricks`, `no-hearts`, …) **não mudam**: são internos.

### Linguagem: compacto na Mesa, natural no Placar (decisão de auditoria)
Os códigos **Q / K e J** só valem onde o espaço é apertado — o chip de penalidade do HUD da Mesa.
Onde há espaço, escreve-se por extenso. **"Homens" foi abolido.**

| Contexto | Forma | Exemplo |
|---|---|---|
| Chip do HUD (Mesa) | compacta — `penaltyText` | `−50 / q` · `−30 / k e j` |
| Placar (penalidade) | natural — `penaltyTextLong` | "−50 por Dama" · "−30 por Rei ou Valete" |
| Placar (unidades capturadas) | natural — `handBreakdown` | "2 Damas" · "3 Reis/Valetes" · "5 Copas" · "4 vazas" · "1 K de Copas" |

**O Placar mostra só o que pontua.** Em "Não pegar Q", quantas vazas alguém levou é irrelevante:
vaza sem Dama não custa nada e o número só concorre com o que importa. Vale para Copas,
Reis/Valetes, K de Copas e as duas últimas. Nos contratos em que a **vaza é a própria unidade**
("Não pegar Vazas" e as positivas), ela continua sendo o dado principal. Quem não pegou nada
aparece como **"escapou"**.

## HUD do contrato — destaque por fase ✅
O HUD carrega o **objetivo da mão**, a informação que mais precisa ser lida — e estava com o
mesmo peso visual dos cards de jogador. Ganhou um **halo na cor semântica da fase**:

| Fase | Cor | Onde aparece |
|---|---|---|
| Negativa (mãos 1–6) | **magenta** `224,51,138` | borda, halo externo, anel interno e a sobrancelha |
| Positiva (mãos 7–10) | **turquesa** `45,212,191` | idem |

- Em repouso o halo é discreto (26px, alpha .3): chama atenção sem virar letreiro.
- **Ao virar a mão** o card toca um realce curto (2,6s): sobe a 46px/alpha .8 em 16% do tempo e
  desce para o repouso. O objetivo mudou — é o momento em que a atenção importa. A **key** do
  React remonta o card a cada mão para o realce tocar de novo.
- A **sobrancelha** ("FASE NEGATIVA · MÃO 2") passou a seguir a cor da fase. Antes era magenta
  também nas positivas, contrariando a semântica do Design System (turquesa = positivo).
- **Só cor e sombra mudam** — a caixa continua idêntica (161×72 no iPhone deitado), então as
  folgas medidas e os testes de layout do Playwright seguem válidos.
- Respeita `prefers-reduced-motion`: quem pede movimento reduzido recebe só o halo estático.

## Selo do castigo — ✅ implementado
Nas mãos negativas, a vaza que levava "bucha" era recolhida em 1,15s sem nome nem número:
ninguém acompanhava **quem** tinha se dado mal, que é justamente a graça dessas mãos. Agora a
mesa **para** e mostra o castigo.

| Elemento | Comportamento |
|---|---|
| Selo | pílula sobre a mesa: avatar + "Fulano pegou" + **o que** (ex.: "2 Damas") + **quanto** (−100) |
| Cor | magenta (tensão, Design System); **K de Copas em ouro com coroa** — é o castigo máximo |
| Você | moldura mais fechada e brilho maior quando o castigo é seu |
| Motion | pop de entrada + pulso lento enquanto a mesa está parada; screen-shake em toda bucha |
| Áudio | `sfxPenalty`; no K de Copas, `sfxKingCaptured` |

**Pausas** (em `game/timings.ts`):
- vaza comum — **1,15s**
- vaza com bucha — **2,7s**
- vaza do K de Copas — **3,4s**

**Onde NÃO se aplica:** em "Não pegar Vazas" toda vaza custa e o vencedor é evidente na mesa —
anunciar as 13 só arrastaria a mão. O selo existe onde a bucha é uma **carta específica**
(Copas, Damas, Reis/Valetes, K de Copas) ou uma vaza específica (as duas últimas), que é o que
ninguém consegue acompanhar sozinho.

## Slot de trunfo — ✅ implementado
Nas mãos **7–10** aparece um slot dedicado logo abaixo do HUD, com o **naipe em tamanho grande**
(≈34px no iPhone deitado, até 3.3rem no desktop) — antes o trunfo era texto miúdo dentro do HUD
e é a informação mais consultada da mão positiva. Vermelho para ♥/♦, branco para ♣/♠, turquesa
para "Sem Trunfo". Abaixo do naipe vem o **nome de quem escolheu o trunfo** — a informação
vive junto do símbolo em vez de ficar perdida no HUD. Nas mãos 1–6 o slot **não existe**
(regra do Design System).

## Placar entre-mãos — ✅ CONGELADO (componente oficial)
Tela que aparece **ao fim de cada mão** e, na 10ª, vira o **placar final**. Não redesenha nada:
usa os tokens congelados (Noite Imperial, Ouro Coroa, turquesa = positivo, magenta = tensão),
Gabarito nos números com `tabular-nums` e o botão candy dourado como ação principal.
- **Cabeçalho:** eyebrow "Mão N de 10 · Fase negativa/positiva", título = **contrato** em degradê
  ouro, e chips com penalidade, trunfo (quando houver, em turquesa, com quem escolheu),
  vazas jogadas e o aviso de **encerramento antecipado** quando a negativa acabou antes da 13ª.
- **Linhas (uma por jogador, ordenadas pela classificação):** posição · **movimentação**
  (▲ turquesa / ▼ magenta / – neutro) · avatar com a cor do assento (a mesma da Mesa) · nome +
  **o que capturou** ("2 damas · 5 vazas", "escapou") · **delta da mão** · **total acumulado**.
  O 1º recebe faixa dourada; a linha do jogador local recebe barra lateral dourada.
- **Rodapé:** **próximo contrato** (mão, nome, penalidade e quem escolhe o trunfo) + CTA candy
  **"PRÓXIMA MÃO ▸"**. No fim da partida: campeão (ou empate) no título, "Home" + "Nova partida".
- **Motion:** `riseIn` no card e stagger nas 4 linhas; respeita `prefers-reduced-motion`.
- **Regra de indexação:** `rankings()` vem ordenado **por posição**, não por assento. Qualquer
  vetor derivado dele precisa ser reindexado por assento antes de virar coluna na tela — foi
  assim que a pontuação de dois jogadores acabou trocada no Placar Final.
- **Regra:** todos os números vêm de `handSummary` (motor). A tela **não recalcula** pontuação
  nem inventa desempate — empate aparece como mesma posição.

**Aprovado e congelado** (a validação na Mão 7 confirmou o mesmo componente nas duas semânticas):
estados negativos · estados positivos · coluna *Nesta mão* · coluna *Total* · ranking e
movimentação de posições · destaque do jogador local · turquesa para ganhos · identificação do
trunfo · identificação de quem escolheu o trunfo · resumo do próximo contrato · indicação do
próximo escolhedor de trunfo · CTA **PRÓXIMA MÃO** · encerramento antecipado das negativas.
**Não fazer nova exploração estrutural sem necessidade funcional comprovada.**

> O **Placar Final** é outra tela (seção abaixo) — o fim da partida não é este componente sem
> o botão "Próxima mão".

## Placar Final / Encerramento — ✅ CONGELADO (componente oficial)
Ápice emocional da partida. **Sequência encenada**, não tabela: entrada → contagem → ranking →
coroação → completo (com "toque para pular"). Motion, áudio e glow com intensidade **acima** do
entre-mãos, sem estética de cassino. Dados 100% do motor; o **checksum final (soma = 0)** aparece
como selo na própria tela.

> **Congelado em 2026-08-19.** A validação determinística final (semente com ordem de
> classificação diferente da ordem dos assentos) confirmou que **cada dado — nome, avatar,
> pontuação, destaque, campeão — segue o `seat`**, e que o ranking é **só ordenação de
> apresentação**. Regressão do bug `ranking × seat` fixada em
> [`placarFinalDados.ts`](../apps/web/src/ui/placarFinalDados.ts) e coberta por
> [`placarFinalDados.test.ts`](../apps/web/src/ui/placarFinalDados.test.ts). Ver a regra
> arquitetural em [KING-ARCHITECTURE.md](KING-ARCHITECTURE.md#identidade-do-jogador-seat--regra-arquitetural).
> **Não fazer nova exploração estrutural sem necessidade funcional comprovada.**

| # | Requisito | Como foi resolvido |
|---|---|---|
| 1 | Transição da última vaza | `sfxFinalSwell` + clarão dourado cobrindo a mesa |
| 2 | Convergência dos pontos | contagem animada do saldo **antes da 10ª** até o final, com tique a cada degrau |
| 3 | Reorganização do ranking | linhas absolutas com `translateY` transicionado — a virada acontece à vista |
| 4 | Revelação do campeão | faixa dourada + glow + `sfxCrownLand` e, 380ms depois, o motivo da coroa |
| 5 | Coroa heroica | SVG do símbolo congelado (recorte em V + gema magenta), desce com overshoot e ganha `floatIdle` |
| 6 | Pontuação de todos | as 4 linhas, `tabular-nums` |
| 7 | Resultado da última mão | faixa discreta no rodapé da coluna de dados |
| 8 | Destaque memorável | escolhido por peso entre estatísticas **reais** (`matchStats`) |
| 9 | Espaço para XP | slot presente e **explicitamente inerte** ("entra na Fase 7") — nada é simulado |
| 10 | CTA principal | **JOGAR NOVAMENTE** se você venceu, **REVANCHE** se não |
| 11 | Compartilhar | `navigator.share` quando existe; senão copia para a área de transferência |
| 12 | Home | ação secundária, violeta |
| 13 | Empate | título "EMPATE!", coroa em cada líder e subtítulo próprio |

- **"O Rei" não aparece**: a arte final 2.5D é etapa posterior e inventar uma versão dele aqui
  contrariaria o congelamento do personagem. O espaço da coluna heroica comporta a entrada dele.
### Decisões da auditoria já incorporadas
- **Duração:** 4,3s é o **teto aprovado** da sequência, com "toque para pular" mantido e
  **micro-pausas deliberadas** entre as etapas: 300ms de respiro depois da contagem e 330ms
  depois da reordenação do ranking (ver `apps/web/src/game/timings.ts`).
- **Peso heroico (moderado):** a coroa desce maior e com mais overshoot, deixa um **anel de
  impacto** que se abre e some, o título ganha um *soco* de escala e a faixa do campeão recebe
  **um único varrer de luz** — nada permanente.
- **Festa curta:** as partículas viram **burst radial** disparado no instante da coroação
  (~1,3s) e desmontam; o clarão dourado acende forte e **cai para um brilho calmo** em 1,6s.
  Não há confete contínuo nem glow pulsando indefinidamente.
- **Conteúdo aprovado**; não acrescentar mais estatísticas. Um botão **`VER DETALHES DA
  PARTIDA`** fica registrado como possibilidade futura, fora deste milestone.
- **Layout aprovado:** duas colunas — área heroica à esquerda, ranking/dados à direita.

- **Reprodutibilidade:** `?seed=N` fixa a semente (o motor é determinístico) — foi assim que o
  cenário de vitória do jogador local foi reproduzido para validação.

## Pendências
- **Logo final** (lettering desenhado) — tarefa de arte com aprovação.
- **Congelamento de valores exatos** (hex/oklch, escala tipográfica, espaçamentos) — na Home.
- **"O Rei" — arte final 2.5D** (conceito já congelado; falta a ilustração de produção).
- **Home** — ✅ congelada (fonte de verdade).
- **Lobby** — ✅ oficial (derivado da Home; regra de ready em `KING-ARCHITECTURE.md`).
- **Mesa** — ✅ arquitetura oficial congelada (ver seção acima).
- **Prova de game feel da vaza** — em apresentação (a Mesa em movimento).
- **Placar entre-mãos** — ✅ CONGELADO (componente oficial).
- **Placar Final / Encerramento** — ✅ CONGELADO (componente oficial; validação determinística `ranking × seat` aprovada).
- **Áudio procedural + haptics** — ✅ implementado (Música/Efeitos/Vibração desligáveis).
- **Responsividade iPhone/iPad/Android/PC + aviso de rotação** — ✅ implementado.
- **Teclado (PC), tela cheia + trava de orientação e botão Voltar (Android)** — ✅ implementado.
