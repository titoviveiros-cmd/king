# KING — Design System (direção oficial)

> Consolida a direção visual **congelada** do KING, derivada do DNA da família (ver
> [VERBETE-GAME-DNA.md](VERBETE-GAME-DNA.md)). **A Home será a fonte de verdade** que congela os
> valores exatos (hex/oklch, escalas, espaçamentos) — este documento fixa a *direção*, não os
> pixels finais. Nada aqui autoriza implementar Home/mesa/personagem definitivos sem validação.

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

## Áudio & haptics (reúso adaptado)
- Engine **procedural** (Web Audio, zero assets, ducking) + **haptics semânticos**
  (`tick/success/fail/bigWin`), reaproveitada do Verbete e adaptada ao KING (eventos: carta
  jogada, vaza, **King capturado** = impacto forte, trunfo, última vaza, vitória) + **motivo da coroa**.
- Controles separados: Música / Efeitos / Haptics — sempre desligáveis.

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

## Pendências
- **Logo final** (lettering desenhado) — tarefa de arte com aprovação.
- **Congelamento de valores exatos** (hex/oklch, escala tipográfica, espaçamentos) — na Home.
- **"O Rei" — arte final 2.5D** (conceito já congelado; falta a ilustração de produção).
- **Home** — ✅ congelada (fonte de verdade).
- **Lobby** — ✅ oficial (derivado da Home; regra de ready em `KING-ARCHITECTURE.md`).
- **Mesa** — ✅ arquitetura oficial congelada (ver seção acima).
- **Prova de game feel da vaza** — em apresentação (a Mesa em movimento).
