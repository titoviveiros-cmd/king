# VERBETE — GAME DNA (referência-mãe da família)

> Extração do DNA criativo e técnico do Verbete (`titoviveiros-cmd/Verbete`, público, branch
> `master`) para orientar o KING. **Acesso somente leitura — nada foi alterado.** Objetivo: não
> copiar o Verbete, e sim identificar *o que faz um jogo parecer criado pela mesma mão* e
> transformar isso numa linguagem compartilhável. **VERBETE e KING são irmãos, não gêmeos.**

### Método (arquivos efetivamente abertos)
Telas renderizadas: `resources/store/shot-{1-home,2-lobby,3-escolha,6-revelacao,7-placar}.png`.
Código: `src/styles.css`, `src/routes/index.tsx`, `src/components/Mascot.tsx`,
`src/components/VerbeteLogo.tsx`, `src/components/ui/button.tsx`, `src/lib/sound.ts`,
`package.json`, `components.json`, `capacitor.config.ts`, e a árvore completa do repo.

### Legenda de rastreabilidade (usada em todo o documento)
- 🟢 **A** — encontrado diretamente no código/telas do Verbete (evidência).
- 🔵 **B** — inferência de design a partir dessas evidências.
- 🟡 **C** — recomendação nova para o KING.

---

## STATUS — DNA RATIFICADO (decisões do usuário)
**O DNA está CONGELADO como base oficial da família**, com a tipografia definitiva **pendente**
de apresentação/aprovação. Decisões:
1. **DNA oficial:** aprovado.
2. **Tipografia:** **CONGELADA** — Display = **Gabarito** (700/800, caixa alta frequente, com
   tratamento nobre via espaçamento/sombra/glow/degradê ouro); Corpo/UI = **Nunito** (400/700).
   **Logo = lettering próprio + coroa** (independente da fonte de UI; arte final à parte, com
   aprovação futura). Não usar Georgia/serifa; não copiar Fredoka/Baloo. Ver `KING-DESIGN-SYSTEM.md`.
3. **Turquesa = cor semântica de positivo/sucesso/confirmação/conexão/fase positiva** — sem ser
   dominante nem pintar em excesso todas as cartas legais.
4. **Ouro comedido:** marca/coroa, liderança, vitória, 1º lugar, conquistas e CTAs realmente relevantes.
5. **Núcleo da paleta confirmado:** Noite Imperial + Roxo Real + Violeta Glow + Ouro Coroa, com
   **turquesa/menta como cor semântica complementar**.
6. **"O Rei":** abordagem aprovada — herdar a **engenharia de estados/reações** do mascote do
   Verbete, mas personagem **totalmente próprio**, 2.5D premium, volumétrico, expressivo, elegante,
   contemporâneo e levemente irônico. **Arte final depende de nova aprovação.**
7. **Reúso técnico aprovado:** infraestrutura genérica de áudio/haptics, botão candy e
   utilities/padrões de animação — **adaptados** ao Design System do KING. **Proibido** copiar
   telas, assets, identidade visual ou aplicar componentes sem adequação estética/funcional.

---

## 1. DNA visual
- 🟢 **A** Estética declarada no próprio código: *"Cartoon party-game vibe: vibrant, playful, pseudo-3D"* (`styles.css`).
- 🟢 **A** **Dois mundos de fundo:** Home = **gradiente vibrante** (magenta→roxo→azul, com partículas de confete); telas de jogo = **fundo escuro** (night-purple) com controles vibrantes por cima.
- 🟢 **A** **Profundidade pseudo-3D real:** botões "candy" com aresta inferior dura (`--shadow-pop: 0 6px 0 0 …`) que some no toque (`active:translate-y-1`), bordas brancas grossas, superfícies glossy, tiles de vidro fosco (frosted glass) e sombras suaves.
- 🟢 **A** **Alto contraste + cor semântica** (ver §13): menta/turquesa = verdade/positivo; magenta/rosa = destaque/tensão; dourado = CTA/vitória; roxo = base.
- 🟢 **A** **Iconografia:** emojis como ícones (🎉 🔑 🔥 🏆 🎯 ❤️) + `lucide-react` + ícones autorais (`VerbeteLogo`, `TrophyIcon`).
- 🔵 **B** Densidade visual **baixa e respirada**: um herói claro por tela, hierarquia forte, cantos muito arredondados (raio base 1.25rem), tudo "tocável".

## 2. DNA de UX
- 🟢 **A** **Mobile-first, portrait**, contêiner `mobile-shell` (max 28rem, `100dvh/svh`, `safe-area-inset`); em desktop vira uma **moldura "device-like"** centralizada com glow (`@media min-width:1024px`).
- 🟢 **A** **Hierarquia de ações clara:** 1 CTA primário dourado ("CRIAR SALA"), 1 secundário branco ("ENTRAR COM CÓDIGO"), ações terciárias em tiles de vidro (Como jogar, Ranking, Desafio, Perfil).
- 🟢 **A** **Social sem chat aberto:** barra de **emotes** (8 reações) fixa no rodapé do jogo + balão de chat flutuante opcional; avatares com anel colorido, badge "VC", remoção com ✕.
- 🟢 **A** **Onboarding/ajuda sempre à mão** (botão "?" persistente no topo; "Como jogar").
- 🔵 **B** Filosofia: **intuitivo, amigável, premium e social** — o jogador nunca precisa "estudar" a tela; tudo se explica por cor, ícone e forma.

## 3. DNA de movimento
- 🟢 **A** Biblioteca: **Framer Motion 12** (+ keyframes CSS em `styles.css`).
- 🟢 **A** **Vocabulário de motion concreto** (valores reais):
  - `pop-in`: `scale .6 → 1.08 → 1`, `cubic-bezier(.34,1.56,.64,1)`, 0.4s → **entrada com overshoot/spring** (a assinatura de "chegada" de elementos).
  - `float-idle`: `translateY -8px` + `rotate ±1°`, 3s easeInOut → respiração/vida em elementos parados.
  - `wiggle`: `rotate ±3°`, 0.5s → provocação/atenção.
  - `screen-shake`: 520–700ms `cubic-bezier(.36,.07,.19,.97)` → **impacto** de momentos fortes.
  - `flash-overlay`: flash branco 600ms `mix-blend:screen` → clímax.
  - `confetti-rise` + `canvas-confetti` → celebração.
- 🟢 **A** Reveal usa `motion` com **stagger** e **spring** (entrada escalonada dos itens, badge de pontos com mola).
- 🔵 **B** **Como o Verbete se move:** entradas saltam com mola, elementos ociosos flutuam, momentos importantes **batem** (shake + flash) e celebram (confete) — movimento sempre proporcional à importância, nunca gratuito. `prefers-reduced-motion` é respeitado.

## 4. DNA sensorial (áudio, haptics, feedback)
- 🟢 **A** **Áudio procedural (Web Audio API, zero assets)** — `sound.ts`/`music.ts`: síntese em tempo real, mixagem por barramento, **ducking** da música sob SFX importantes, `jitterCents` (variação orgânica p/ não soar robótico), stinger cinematográfico (acorde menor c/ 7ª = suspense), crash+kick no clímax.
- 🟢 **A** **Haptics semânticos** (o tato conta a mesma história do som): `hapticTick` = 10ms; `hapticSuccess` = [25,40,55]; `hapticFail` = [70]; `hapticBigWin` = [30,45,30,45,95] (padrão **crescente** p/ vitória); impacto de clímax = [60,40,120]. Sempre respeitam o mute global.
- 🟢 **A** **Feedback multicanal proporcional:** visual + som + haptic disparam juntos, escalando com a importância do evento.
- 🔵 **B** Princípio: **três canais contando a mesma história** — reconhecível mesmo no mudo (cor/forma) e mesmo sem olhar (tato).

## 5. DNA emocional
- 🟢 **A** Tom das telas e da cópia ("Blefe, vote e descubra"; emotes; confete): **divertido, leve, vibrante, acolhedor, competitivo sem agressividade, premium e moderno.**
- 🟡 **C** **DNA emocional permanente da família** (deve valer no KING): **vibrante + premium + social + com profundidade + com personalidade**, competitividade amigável. O KING adiciona **tensão e prestígio** (coroa/estratégia) sem perder a leveza.

## 6. Mascote / personagem e função original
- 🟢 **A** É o **"Livro Mascote"** (`Mascot.tsx`): SVG pseudo-3D de um livro com **rosto** (olhos brancos com pupila escura, boca, bochechas rosa `#FF85A2`), capa roxa `#7B2CBF` com contorno escuro `#3A0A60`, páginas creme.
- 🟢 **A** **Sistema de humores** por prop `mood`: `idle | excited | thinking | wow | sad` — muda olhos (pupilas se movem no "thinking", crescem no "wow"), boca (sorriso/O/tristeza) e **sparkles ✨⭐** no "excited"; **float idle** (`y:[0,-8,0]`, `rotate ±2°`, 3s; excited = `±4°`, 0.6s).
- 🟢 **A** **Nota importante:** o mascote **permanece no código** mas **saiu do herói da Home atual** (comentário em `index.tsx`: hero passou a usar o logo). Ou seja, o personagem é parte do DNA de concepção, ainda que hoje discreto na Home.
- 🔵 **B** Função original: **presença viva e reativa** (flutua, reage por humor, comemora com brilhos) — encanto simples porém expressivo, com **arquitetura orientada a estados**.

## 7. Home e navegação (`index.tsx` + shot-1)
- 🟢 **A** Herói vertical: logo em tile glossy (V + livro) → wordmark "Verbete" (display arredondado pesado, com sombra roxa) → subtítulo com **palavras-chave coloridas** → **card de stats** (STREAK/JOGOS/VITÓRIAS/RECORDE) → CTA dourado → secundário branco → tiles terciários → Perfil → rodapé com metadados. Toggle de som e tema no topo.
- 🔵 **B** Navegação por **file-based routes** (TanStack Router): `/`, `/room/$code`, `/profile`, `/ranking`, `/daily`, etc.

## 8. Lobby / salas (shot-2)
- 🟢 **A** "CÓDIGO: 7150" (dourado) + status dot; **Compartilhar** (dourado); grid de jogadores (avatares animais com anel colorido, slots vazios tracejados "?"); botões de **bot** turquesa 3D ("+1 Bot", "Encher até 4"); **modo** (Individual/Equipes), **fim da partida** (rodadas/pontos), **nível das palavras** (dots verde→vermelho); emote bar no rodapé.
- 🔵 **B** Lobby é **vivo e social**: preencher com bots, compartilhar, reagir — expectativa antes de começar.

## 9. Gameplay (shots 3/6)
- 🟢 **A** Fases do jogo de palavras (`components/room/phases/`): `Shuffling`, `ChooseWord`, `WriteDefinition`, `Voting`, `Reveal`, `Scoreboard`, `Finished`. Cartões grandes, arredondados, com forte cor semântica; palavra em card gradiente rosa→roxo com **text-stroke** branco.
- 🟡 **C** *A mecânica em si (palavra/definição/blefe/voto) é exclusiva do Verbete — não migra.* O que migra é a **gramática de apresentação** (cards, cor semântica, ritmo).

## 10. Revelações, fases e tensão (shot-6, PhaseAnnouncer)
- 🟢 **A** Revelação **encenada em camadas**: contador ("PLACAR EM 9s") → palavra → **definição verdadeira** (card turquesa) com "ACERTARAM +3" → **blefes riscados** (strike rosa) atribuídos ao autor. `PhaseAnnouncer` anuncia cada fase.
- 🔵 **B** A tensão é construída por **timing e cor**: contagem, verdade em verde, mentira riscada em rosa — leitura instantânea de quem ganhou/perdeu o momento.

## 11. Placar e celebrações (shot-7)
- 🟢 **A** "Placar 🏆" (título dourado); linhas de ranking com **medalha** (ouro #1 com **borda/anel dourado em glow**, prata #2), avatar, nome, pontuação grande, e **detalhamento** ("🎯 Acertou a verdade 1× → +3 pts"); CTA "Próxima rodada".
- 🟢 **A** Celebração: `Confetti.tsx` + `canvas-confetti` + `hapticBigWin` + flash/shake disponíveis.

## 12. Progressão e conquistas
- 🟢 **A** Stats na Home (streak, jogos, vitórias, recorde); `AchievementToaster.tsx` (toast de conquista); `TrophyIcon`; rotas `/ranking`, `/profile`, `/daily` (desafio diário).
- 🔵 **B** Progressão leve e **não intrusiva** (toasts, badges, streak) — recompensa sem poluir.

## 13. Design tokens (cores, tipografia, sombras, glow, profundidade)
- 🟢 **A** **Tipografia:** display `--font-display: "Fredoka", "Baloo 2"` (arredondada, pesada, `-0.01em`); corpo `--font-body: "Nunito"`. Botões/títulos em Fredoka, muitas vezes uppercase.
- 🟢 **A** **Cores (oklch):** fundo `0.22 0.09 290` (night-purple); card `0.28 0.10 285`; **pink/primary** `0.72 0.22 0`; **sun/amarelo** `0.88 0.18 95`; **mint** `0.78–0.82 0.16 175`; **sky** `0.78 0.14 230`; **grape** `0.55 0.20 305`. Texto near-white quente `0.98 0.01 90`.
- 🟢 **A** **Gradientes:** `fun` (pink→magenta→grape 135°), `sun` (amarelo→laranja), `mint`. **Fundo night** radial no topo.
- 🟢 **A** **Sombras/profundidade:** `shadow-pop` (aresta dura 6px + drop suave) = pseudo-3D; `shadow-soft`; `shadow-glow` (`0 0 32px pink/.45`); `text-stroke` 2px; `.btn-pop` (candy 3D com `active:translate-y-1`); `.sticker` (card com pop).
- 🟢 **A** **Raio** base `1.25rem` (escala sm→3xl). **Tema duplo:** night-purple (padrão) + **cream quente** (`.light`).
- 🟢 **A** **Botões:** a assinatura é a utility **`.btn-pop`** (chunky, borda grossa, uppercase Fredoka), **não** o `Button` shadcn padrão (esse é para UI utilitária).

## 14. Framer Motion e padrões reais de animação
- 🟢 **A** Padrões concretos: **entrada com mola/overshoot** (`pop-in` / spring), **stagger** em listas (Reveal), **float idle** (mascote e elementos vivos), **shake+flash** para impacto, **confetti** para vitória, **wiggle** para atenção.
- 🟡 **C** Reusar esses **primitivos** no KING como um `motion` compartilhado (mesmos easings/durações), trocando só o conteúdo.

## 15. Componentes / princípios compartilháveis (Shared Game Design System)
- 🟡 **C (princípios):** filosofia de profundidade (`shadow-pop`), botão candy (`.btn-pop`), glow controlado, linguagem de cards, ritmo de motion (pop-in/float/shake/flash), microfeedbacks, filosofia sonora procedural, **haptics semânticos**, celebrações (confete), tratamento de avatares, `mobile-shell`/safe-area, tema duplo, tipografia arredondada (Fredoka/Nunito), cor semântica.
- 🟡 **C (componentes potencialmente reutilizáveis, após avaliação):** `sound.ts`/`music.ts` (engine de áudio+haptics, agnóstico de jogo), `Confetti`/`confetti.ts`, `AchievementToaster`, `AvatarBubble`, `SoundToggle`/`ThemeToggle`, o **sistema de humores do mascote** (arquitetura, não o desenho), utilities de CSS (`btn-pop`, `sticker`, `text-stroke`, `mobile-shell`), `ReactionsLayer` (emotes).

## 16. Exclusivos do Verbete (NÃO migram para o KING)
- 🟢/🟡 O **Livro Mascote** (forma/identidade); o **logo/wordmark "Verbete"** e o tile "V+livro"; a tagline "Blefe, vote e descubra"; as **fases de palavra/definição/blefe/voto** (`ChooseWord`, `WriteDefinition`, `Voting`, `Reveal` — lógica e cópia); o **desafio diário de palavras**; os assets/screens específicos; os **valores exatos de hue** (o KING usa uma derivação imperial); o **layout portrait travado** (o KING é landscape).

## 17. Matriz VERBETE × DNA COMPARTILHADO × KING
| Dimensão | VERBETE (🟢 A) | DNA compartilhado (🟡 C) | KING (🟡 C) |
|---|---|---|---|
| **Personalidade** | divertido, leve, vibrante, acolhedor | vibrante + premium + social + personalidade | + tensão, prestígio, "domínio" |
| **Cores** | night-purple + pink + sun + mint + sky + grape | roxo-noite base + acentos vibrantes + cor **semântica** | Noite Imperial + Roxo Real + Violeta Glow + **Ouro Coroa** (deriva) |
| **Profundidade** | `shadow-pop` 3D, glow, glass | pseudo-3D volumétrico + glow controlado | superfícies premium/metálicas + coroa |
| **Motion** | pop-in spring, float, shake, flash, confete | mesmos primitivos e durações | + "batida" no King capturado e virada |
| **Personagem** | Livro (mood system, float) | **arquitetura** de humores + float + reações | **"O Rei"** 2.5D premium (outra forma) |
| **UI** | portrait mobile-shell, tiles glass, `.btn-pop` | botão candy, cards, hierarquia, safe-area | **landscape** (mesa 13 cartas), mesmo botão candy |
| **Feedback** | visual+som+haptic proporcional | 3 canais contando a mesma história | idem, escalando p/ momentos KING |
| **Áudio** | procedural, ducking, stinger | engine procedural reutilizável | motivo curto da **coroa** |
| **Haptics** | tick/success/fail/bigWin | mesmos padrões semânticos | + impacto no King, sequência na vitória |
| **Vitória** | placar c/ medalhas + confete + bigWin | pódio + celebração premium | coroação do campeão |
| **Progressão** | streak/jogos/vitórias, toasts, ranking | XP/conquistas leves, não intrusivas | stats KING (Kings evitados, viradas…) |
| **Tipografia** | Fredoka/Baloo + Nunito | **mesma** dupla arredondada | **manter Fredoka/Baloo + Nunito** |
| **Orientação** | portrait | mobile-first, safe-area, device-frame | **landscape** (necessidade do baralho) |

## 18. Anti-copy checklist (impedir que o KING vire reskin)
- [ ] Não usar o Livro Mascote nem uma variação dele — "O Rei" é outra criatura.
- [ ] Não reaproveitar logo/wordmark/tagline do Verbete.
- [ ] Não migrar as fases de palavra/definição/blefe/voto.
- [ ] Não copiar telas/composição/assets do Verbete 1:1.
- [ ] Derivar a paleta imperial (não colar os hues exatos do Verbete).
- [ ] KING é **landscape**; não herdar o layout portrait como se fosse regra.
- [ ] Herdar **princípios e primitivos** (motion, sombra, som, haptics, tipografia), não conteúdo.
- [ ] Cada tela do KING deve passar em dois testes: "tem a mão do criador?" **e** "é KING, não Verbete com cartas?".

## 19. Implicações concretas para a Home do KING
- 🟡 **C** Manter a **estrutura de herói vertical** e a hierarquia (1 CTA dourado "JOGAR" + secundários), o **card de stats**, os **tiles de vidro** e os toggles de som/tema no topo — mas com **fundo imperial** (roxo-noite + violeta, luz quente) no lugar do gradiente pink, e o **logo/coroa do KING** no lugar do tile "V".
- 🟡 **C** A Home continua sendo a **fonte de verdade do Design System** (a congelar depois da aprovação).

## 20. Implicações concretas para a mesa do KING
- 🟡 **C** A mesa é **landscape** (decisão já tomada) — diverge do portrait do Verbete por necessidade (13 cartas + 4 jogadores). Herdar: `safe-area`, contêiner tipo `mobile-shell` adaptado a landscape, cards com `shadow-pop`, cor semântica (turquesa = "seguro/positivo", magenta = "perigo/King"), emote bar e avatares com anel colorido.
- 🟡 **C** Reservar o **fundo escuro imperial** para a mesa (como o Verbete usa fundo escuro no jogo), com o gradiente vibrante só em momentos de destaque/transição.

## 21. Implicações para o personagem "O Rei"
- 🟡 **C** Herdar a **arquitetura**, não a forma: prop de **humores** (ex.: `idle | tenso | comemorando | derrota | orientando`), **float idle**, **reações a eventos** (sua na tensão do King, comemora com a coroa), olhos/expressão expressivos.
- 🟡 **C** Elevar a **fidelidade**: o mascote do Verbete é um SVG simples e charmoso; "O Rei" deve ser **2.5D premium** (volume, iluminação, materiais, ótima silhueta, leve ironia) — claramente do mesmo universo, **sem** ser livro nem rei medieval genérico nem clip-art. Mesma mão criativa, outra criatura.

## 22. Implicações para animações
- 🟡 **C** Adotar os **mesmos primitivos** do Verbete: `pop-in` (entrada mola), `float-idle` (cartas/HUD vivos), `screen-shake`+`flash` para **momentos heróicos** (King capturado, última vaza, virada), `stagger` na distribuição das 13 cartas, `confetti`/`bigWin` na vitória. Respeitar `prefers-reduced-motion`.

## 23. Implicações para áudio e haptics
- 🟡 **C** Reaproveitar (após avaliação) a **engine procedural** `sound.ts`/`music.ts` — zero assets, ducking, jitter — e os **haptics semânticos** (`tick/success/fail/bigWin`), adicionando eventos KING (carta jogada, vaza conquistada, **King capturado** = impacto forte, escolha de trunfo, última vaza, vitória) e um **motivo sonoro curto da coroa**. Controles separados Música/Efeitos/Haptics, sempre desligáveis.

---

## Diferença crítica de tipografia (recomendação de ajuste)
🟡 **C** O painel de arte do KING aprovado usou um **display serifado (Georgia)**. Para o KING de fato "ter a mão do mesmo criador", **recomendo trocar para a mesma dupla do Verbete — Fredoka/Baloo (display) + Nunito (corpo)** — talvez com um tratamento um pouco mais "nobre" (peso/espaçamento), mas dentro da mesma família arredondada. Serifa quebra o parentesco visual. *(Sujeito à sua validação.)*
