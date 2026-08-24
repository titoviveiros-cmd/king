# KING — Game Design Bible

> Documento vivo. Regras detalhadas em [KING-RULES.md](KING-RULES.md); arquitetura em
> [KING-ARCHITECTURE.md](KING-ARCHITECTURE.md); testes em [KING-TEST-PLAN.md](KING-TEST-PLAN.md).
> Direção de arte visual aprovada no painel: *KING — Direção de Arte* (paleta, wireframes, mascote).

## 1. Visão
KING é um **casual competitive social game premium**, multiplayer-first e mobile-first: um
*videogame construído em torno de um baralho*, não um baralho numa tela. Segundo título da
**família criativa do Verbete** — mesmo DNA, universo próprio. Sequência emocional-alvo:
"Isso é bonito" → "É fácil de entender" → "Parece um jogo de verdade" → "Droga!" (ao levar o
King) → "Boa!" (virada na positiva) → "Vamos outra".

## 2. DNA da família Verbete (herdado) × identidade KING (própria)
- **Herdado:** comportamento de botões, ritmo de transições, filosofia de haptics e de áudio,
  tratamento de avatares, partículas, cards, modais, telas de vitória, progressão, conquistas,
  loading, microinterações, motion language.
- **Próprio do KING:** paleta imperial (Noite Imperial, Roxo Real, Violeta Glow, Ouro Coroa +
  magenta/violeta), a **coroa** como leitmotiv, o **Rei de Copas** como carta-ícone, o ritual
  de vazas, a dramaticidade da virada negativa→positiva, assinatura sonora da coroa.
- **Proibições:** feltro verde como identidade, cassino, poker, clone do Verbete, medieval
  genérico, visual infantil/clip-art.

## 3. Personagem — "O Rei"
Rei carismático, expressivo e **levemente irônico** (aprovado como conceito). Versão final
deve ser **cartoon 2.5D premium**: volume, profundidade, iluminação, ótima silhueta.
Função (não decoração): onboarding, loading/splash, tensão quando o K♥ circula (sem revelar
quem o tem), celebração, acolhimento na derrota. **Pendente:** folha de expressões
(neutro/tenso/comemorando/orientando) — aguarda nova validação antes da produção visual final.

## 4. Contratos e ritual das 10 mãos
As 10 mãos são uma jornada, não "Rodada 1, 2, 3". Ver totais e regras em KING-RULES.md.
- **Fase Negativa (mãos 1–6):** "evite perder pontos". Cada contrato tem identidade visual
  (vaza, Copas, Damas, Reis e Valetes, King, duas últimas). Tensão sobe nas vazas 10→11→12→13 da mão 6.
- **Grande transição (após a 6ª):** segundo ato. "É hora de atacar." Iluminação muda,
  partículas, coroa aparece, trilha evolui, HUD ganha energia. Apresenta a **Fase Positiva**.
- **Fase Positiva (mãos 7–10):** cada vaza vale +25; o beneficiado escolhe o trunfo (rotação
  M7→P0 … M10→P3). Interface de trunfo especial: 4 grandes símbolos de naipe + "Sem Trunfo"
  (nunca dropdown).
- **Revelação de contrato:** apresentação curta e impactante (1–2s) antes de cada mão
  (ex.: "👑 MÃO 5 — NÃO PEGUE O KING · K♥ = −160"), com luz/som/microefeito; nunca cansativa.

## 5. Abertura da partida (ritual)
Mesa ganha vida → jogadores assumem posições → baralho entra → embaralha → distribui → mão se
organiza → contrato revelado → começa. Nada instantâneo.

## 6. Mesa e UX (Landscape — orientação oficial)
- 4 lados; **jogador local embaixo**; adversários à esquerda, topo e direita.
- Adversário mostra só o permitido: avatar, nickname, nº de cartas, status, turno, conexão,
  pontuação pública. **Nunca** as faces das cartas alheias.
- Mão: leque largo com 13 cartas legíveis; carta ativa eleva; cartas **ilegais** perdem ênfase
  discreta (não jogáveis, sem "árvore de Natal").
- **HUD inteligente do contrato** sempre visível (ex.: "❤️ EVITE COPAS", "VAZA 11/13 ⚠️
  próximas valem −90", "♠ TRUNFO: ESPADAS · +25/vaza").
- **Clareza (seção 71):** em poucos segundos o jogador responde — É minha vez? O que evitar/buscar?
  Quais cartas posso jogar? Qual o trunfo? Quem ganhou a última vaza? Como estou no placar?

## 7. Game feel (movimento + som + haptic proporcionais)
Cartas como **objetos físicos**: deck→trajetória→mão; seleção→elevação; jogar→curva→pouso→
impacto; vaza→4 cartas agrupam→vão ao vencedor; reorganização suave. 60 FPS (transform/opacity,
com fallback). Momentos heróicos: **King capturado** (destaque, magenta, haptic forte), última
vaza (tensão/áudio sobem), vitória (celebração premium + motivo da coroa). Sem revelar
informação estratégica oculta.

## 8. Telas
Splash · Home · Lobby · Mesa · Revelação de contrato · Escolha de trunfo · Placar entre-mãos ·
Placar final (pódio, rematch, compartilhar) · Perfil · Conquistas · Configurações · Tutorial.
- **Home** = fonte de verdade do Design System (a ser congelada depois). CTA principal **JOGAR**;
  secundárias: jogar online, jogar com amigos, criar sala, entrar com código, treinar com bots,
  perfil, conquistas, configurações.
- **Lobby** social e vivo: 4 posições, avatar/nick/bot-humano/ready, código da sala, compartilhar,
  host; expectativa antes de entrar na mesa.

## 9. Onboarding — "Aprenda KING"
Tutorial interativo com 3 bots; ensina **jogando** em 16 passos (vaza → servir → negar →
vencedor → contratos → King → duas últimas → trunfo → positiva → pontuação). Termos como
"negar" ganham explicação didática. Sem manual gigante.

## 10. Placares
- **Entre-mãos:** resultado da mão, mudança individual, ranking atualizado, próximo contrato.
  Transição rápida (sem tabela complexa).
- **Final:** contagem/rearranjo → 🥇 campeão → 🥈🥉4º; estatística divertida, conquista, rematch,
  compartilhar. Empate = mesma colocação (sem desempate inventado). Derrota sem humilhação
  (XP, feedback, incentivo saudável).

## 11. Progressão, conquistas, cosméticos
- Perfil: avatar, nickname, nível, XP, partidas, vitórias, pódios, vazas, contratos, sequência.
- Estatísticas KING: Kings evitados/capturados, mãos perfeitas, Copas/Damas evitadas, vitórias
  na última mão, maior virada, melhor saldo.
- Conquistas (nomes a revisar): Longe do Trono, Coração Gelado, Sem Rainhas, Virada Real, Mão de Ferro.
- Cosméticos: avatares, molduras, backs, mesas, efeitos, emotes, títulos. **NEVER PAY-TO-WIN.**

## 12. Social & viralidade (sem dark patterns)
Convite simples ("jogar com amigos"), código de sala fácil de copiar, deep link (arquitetura
preparada), resultado compartilhável com branding KING, rematch em 1 toque, emotes/microreações
(sem chat aberto no MVP). Viralidade pela **qualidade da experiência**.

## 13. Áudio & haptics
Categorias: UI, Cartas, Game, Social, Ambiente. Assinatura sonora da coroa (curta) em
início/vitória/King. Controles **separados**: Música / Efeitos / Haptics (sempre desligáveis).
Haptics contextuais e proporcionais (tap leve → King impacto maior → vitória em sequência).

## 14. Acessibilidade & i18n
Contraste, alvos de toque adequados, texto legível, redução de movimento, som não obrigatório
para compreensão, informação que não dependa só de cor, símbolos de naipe claros. **i18n desde
o início**; 1º idioma **pt-BR**; estruturado para tradução futura.

## 15. Analytics (desacoplado)
Eventos: `app_open`, `tutorial_started/completed`, `matchmaking_started`, `room_created/joined`,
`match_started`, `hand_started`, `card_played`, `king_captured`, `trump_selected`,
`match_finished`, `rematch_clicked`, `invite_shared`, `disconnect`, `reconnect`. Sem dados
pessoais desnecessários; instrumentação não prejudica gameplay.

## 16. Estado do projeto (fases)
- ✅ **Fase 1 — Docs** (este conjunto).
- ✅ **Fase 2 — Rule Engine** implementado em `packages/engine` (testes escritos; execução
  pendente de Node.js).
- ⏳ Fase 3 simulação em massa · Fase 4 vertical slice · Fase 5 game feel · Fase 6 multiplayer ·
  Fase 7 meta · Fase 8 polimento · Fase 9 release.

## 17. Decisões e pendências
**Decidido:** stack Web/React+TS (+Capacitor); orientação **Landscape**; personagem "O Rei"
(abordagem); paleta imperial (núcleo confirmado + turquesa semântica); **tipografia CONGELADA
(Gabarito display + Nunito corpo; logo = lettering próprio + coroa)**; regra do K♥ = **forçado a
jogar o Rei**; restrição de abrir Copas só nas mãos 2 e 5; rotação de trunfo M7–M10 → P0–P3;
empate = empate. **DNA do Verbete extraído e ratificado** (ver `VERBETE-GAME-DNA.md` e
`KING-DESIGN-SYSTEM.md`).
**Pendente de nova validação:** produção visual final do personagem, logo (arte), Home e mesa;
congelamento dos valores exatos do Design System a partir da Home.
