# KING — Pacote de produção: Sapo + Panda

**Prova de linguagem visual.** Estes dois personagens não são apenas os dois primeiros: eles
existem para **definir a linguagem** que os outros seis vão herdar sem discussão.

Foram escolhidos porque são os extremos do elenco. Se a mesma direção de arte servir aos dois,
serve a qualquer um:

| | Sapo | Panda |
|---|---|---|
| Silhueta | cúpulas salientes no topo | círculo limpo |
| Material | pele úmida e brilhante | pelo denso e fosco |
| Contraste interno | médio, por cor | **máximo**, por valor (preto × branco) |
| Expressão | assimétrica e provocadora | simétrica e serena |
| Amplitude | alta | baixa |

Se a luz que faz a pele do Sapo parecer úmida também fizer o pelo do Panda parecer macio — e se
o preto do Panda não virar buraco sob a mesma luz —, a linguagem está provada.

Referência congelada: [KING-AVATARS-ART-BRIEF.md](KING-AVATARS-ART-BRIEF.md).

---

## 1. Bloco comum — a linguagem

> **Este bloco é idêntico nos dois prompts e será colado sem alteração nos outros seis.**
> É literalmente a linguagem visual do KING. Se precisar ser reescrito para algum personagem
> funcionar, a linguagem falhou — e é isso que a prova está testando.

```
LINGUAGEM VISUAL KING — BLOCO COMUM

Retrato de cabeça e pescoço de um animal antropomorfizado, de frente para o
observador. Sem corpo, sem mãos, sem objetos, sem cartas, sem texto.

ESTILO: cartoon 2.5D premium de videogame. Formas cheias e volumétricas, com
peso e profundidade reais. Não é vetor chapado, não é ícone, não é 3D
fotorrealista. Acabamento de personagem de jogo AAA estilizado — limpo,
caprichado, com superfícies que se leem pelo material.

ILUMINAÇÃO (idêntica para todos os personagens do elenco):
- luz principal quente e suave, vindo de cima e da esquerda, aproximadamente
  às 10 horas, criando um lado claro definido;
- luz de preenchimento fria em violeta #9b6cff, vindo da direita e de baixo,
  fraca — presente o bastante para se notar na sombra, nunca dominante;
- contraluz sutil em dourado #f4c542 na borda superior da silhueta, fina e
  discreta, dando separação e acabamento;
- occlusão suave nas dobras e nos encaixes (pálpebras, comissura da boca,
  base das orelhas). Sombra por oclusão, nunca contorno preto uniforme por
  dentro do desenho.

CONTORNO: contorno externo fechado em Noite Imperial #140a24, com 8 a 12 px
de espessura no master de 1024 px, acompanhando toda a silhueta. Espessura
levemente variável (mais grosso nas sombras, mais fino na luz). Este contorno
é obrigatório: é o que garante leitura sobre fundos dourado, turquesa, violeta
e magenta.

COR: cores naturais da espécie, saturação média-alta, sem tingir o personagem
de roxo ou dourado. A identidade do jogo vem da luz e do acabamento, nunca de
pintar o animal com as cores da marca.

OLHOS: são o investimento principal. Grandes para o padrão da espécie, com
pupila escura bem definida e um brilho especular branco e nítido, mais um
segundo brilho menor e mais fraco. Olhar dirigido ao observador.

ASSIMETRIA: o personagem nunca é bilateralmente simétrico. Pelo menos um
elemento intencionalmente desalinhado.

FUNDO: transparente. Nenhum cenário, nenhuma sombra projetada, nenhum halo,
nenhuma vinheta.

SEM: coroa, chapéu, óculos, colar, roupa, adereço de qualquer tipo.
```

---

## 2. Prompt definitivo — `sapo` · **Sapo, O Malandro**

### 2.1 Prompt canônico (fonte da verdade)

```
[BLOCO COMUM — colar aqui a seção 1 inteira]

PERSONAGEM: SAPO — O MALANDRO

Um sapo/perereca antropomorfizado, esperto e confiante, com o ar de quem já
sabia o que ia acontecer. Provocador simpático, jamais agressivo. É o
personagem mais à vontade da mesa.

CABEÇA: oval largo e baixo, mais largo que alto, com o queixo cheio e uma
papada discreta. O crânio é baixo — o volume está na largura.

OLHOS (o traço número um): dois domos esféricos e salientes posicionados
ACIMA da linha do crânio, saindo por cima da silhueta como duas cúpulas. Íris
dourada quente, pupila horizontal escura, pálpebra superior espessa e
carnuda. A PÁLPEBRA ESQUERDA É VISIVELMENTE MAIS BAIXA QUE A DIREITA — é
disso que vem a malandragem, e não de acessório nenhum. Brilho especular
forte e concentrado no alto de cada domo.

BOCA (o traço número dois): a boca mais larga do elenco, atravessando quase
toda a largura da cabeça, com o CANTO DIREITO CLARAMENTE ELEVADO num sorriso
de canto. Lábio fino, linha limpa e contínua. Sem dentes à mostra na
expressão neutra.

PELE: verde-esmeralda no dorso e no topo da cabeça, transitando para creme
amarelado no queixo e na papada. Pele lisa e ÚMIDA, com brilho especular
amplo no alto do dorso — é o material mais brilhante do elenco. Bordas da
papada levemente translúcidas, deixando a luz atravessar. Pintas irregulares
e assimétricas em verde mais escuro, espalhadas sem padrão no dorso e ao
redor dos olhos.

POSE: frontal com aproximadamente 10 graus de rotação da cabeça, queixo
baixo, olhando ligeiramente de baixo para cima na direção do observador. É a
pose de quem está confortável e não pretende levantar.

EXPRESSÃO (neutro): sorriso de canto largo, olhar vivo e ligeiramente de
lado, pálpebra esquerda mais baixa. Malícia amigável. A leitura tem de ser
"eu já sabia".

O QUE PRECISA SOBREVIVER A 26 px: as duas cúpulas oculares saindo do topo da
silhueta, e a linha larga da boca embaixo. Nada mais é obrigatório.
```

### 2.2 Versão compacta para gerador de imagem (inglês)

```
Anthropomorphic frog character portrait, head and neck only, front view,
premium 2.5D game cartoon style, volumetric shapes, clean AAA stylized game
finish. Wide low oval head, full chin, subtle dewlap. Two large spherical
domed eyes sitting ABOVE the skull line like two domes on top of the
silhouette, golden warm iris, dark horizontal pupil, thick fleshy upper
eyelids, LEFT EYELID CLEARLY LOWER THAN THE RIGHT, strong concentrated
specular highlight on each dome. Very wide mouth spanning nearly the full
head width, RIGHT CORNER RAISED in a confident smirk, thin clean lip line, no
teeth showing. Emerald green wet smooth skin on top fading to creamy yellow
under the chin, broad specular sheen across the back of the head, slightly
translucent dewlap edges, irregular asymmetric darker green speckles. Head
rotated about 10 degrees, chin low, looking slightly upward at the viewer,
relaxed and confident, sly friendly smirk, "I already knew" expression.
Warm key light from upper left at 10 o'clock, cool violet #9b6cff fill from
lower right, subtle gold #f4c542 rim light along the top edge, soft occlusion
in the folds. Closed dark outline #140a24 around the whole silhouette,
slightly variable thickness. Transparent background. No crown, no hat, no
glasses, no clothing, no accessories, no props, no text, no scenery.
```

---

## 3. Prompt definitivo — `panda` · **Panda, O Tranquilo**

### 3.1 Prompt canônico (fonte da verdade)

```
[BLOCO COMUM — colar aqui a seção 1 inteira]

PERSONAGEM: PANDA — O TRANQUILO

Um panda-gigante antropomorfizado, sereno e simpático, praticamente
impossível de tirar do eixo. É quem perde alto e ri junto com quem aplicou.
Estabilidade é o personagem.

CABEÇA: círculo generoso e cheio, quase geométrico na sua simplicidade, com
duas orelhas pequenas e arredondadas no alto. Massa simples — a força vem do
padrão, não da forma.

MANCHAS (o traço número um): orelhas pretas e duas manchas oculares pretas
arredondadas, ligeiramente DIFERENTES ENTRE SI em tamanho e inclinação — a
esquerda um pouco maior e mais caída. O resto do rosto é branco quente. É o
maior contraste de valor do elenco, e é o que faz o personagem funcionar
mesmo desfocado.

O PRETO NUNCA É CHAPADO: dentro das áreas escuras há variação de valor, com
a luz de preenchimento violeta acendendo as bordas e a luz principal quente
tocando o topo das orelhas. Preto absoluto vira buraco na tela e está
proibido.

OLHOS: pequenos e escuros, posicionados DENTRO das manchas oculares — são as
manchas que fazem o trabalho de tamanho aparente. Para compensar o escuro, o
brilho especular branco é grande e bem definido, mais um segundo brilho
menor.

FOCINHO E BOCA: focinho curto, nariz preto arredondado com brilho úmido, boca
pequena com os dois cantos suavemente elevados num meio sorriso genuíno e
contido.

PELO: denso e macio, levemente felpudo no contorno da silhueta, com fios
sugeridos na transição entre o preto e o branco. Material fosco, sem brilho
— o oposto exato da pele do sapo. Branco quente, nunca branco puro.

POSE: rigorosamente frontal, estático, centralizado, sem rotação. A
imobilidade é o personagem.

EXPRESSÃO (neutro): olhos calmos e levemente semicerrados, meio sorriso
pequeno e genuíno. Serenidade, não sonolência.

O QUE PRECISA SOBREVIVER A 26 px: as duas manchas oculares escuras, as duas
orelhas escuras e o campo branco entre elas. Nada mais é obrigatório.
```

### 3.2 Versão compacta para gerador de imagem (inglês)

```
Anthropomorphic giant panda character portrait, head and neck only, front
view, premium 2.5D game cartoon style, volumetric shapes, clean AAA stylized
game finish. Full round head, two small rounded black ears on top. Two
rounded black eye patches, SLIGHTLY DIFFERENT FROM EACH OTHER in size and
tilt, left one a bit larger and lower, warm white face, maximum value
contrast. Black areas have visible value variation, violet fill light on the
edges, warm key light on top of the ears, never flat pure black. Small dark
eyes set INSIDE the black patches, large crisp white specular highlight plus
a smaller secondary highlight. Short muzzle, rounded black nose with wet
sheen, small mouth with both corners gently raised in a genuine contained
half smile. Dense soft matte fur, slightly fluffy silhouette edge, suggested
fur strands in the black-to-white transition, no sheen on the fur. Strictly
frontal, static, centered, no rotation. Calm slightly narrowed eyes, serene
not sleepy. Warm key light from upper left at 10 o'clock, cool violet
#9b6cff fill from lower right, subtle gold #f4c542 rim light along the top
edge, soft occlusion in the folds. Closed dark outline #140a24 around the
whole silhouette, slightly variable thickness. Transparent background. No
crown, no hat, no glasses, no clothing, no accessories, no props, no text,
no scenery.
```

---

## 4. Negative prompt / restrições

### 4.1 Proibições de conteúdo

- coroa, chapéu, óculos, colar, gravata, roupa, cartas, fichas, qualquer adereço;
- corpo, ombros completos, braços, mãos, patas;
- cenário, fundo pintado, sombra projetada no chão, halo, vinheta, moldura;
- texto, número, logotipo, marca d'água, assinatura;
- baralho, mesa, feltro, dinheiro, símbolo de naipe.

### 4.2 Proibições de estilo

- flat vector, clip-art, ícone de interface, adesivo, emoji;
- 3D fotorrealista, render de Blender cru, sub-surface exagerado;
- animal realista de referência fotográfica;
- furry hiperdetalhado, antropomorfismo excessivo (corpo humano com cabeça de bicho);
- chibi extremo, olhos de anime com quatro brilhos, estilo mascote de cassino;
- estilo de aplicativo infantil simplificado;
- linha de contorno interna uniforme (o contorno é só externo);
- preto absoluto chapado, branco puro chapado;
- gradiente de fundo, transparência parcial na borda, glow externo difuso.

### 4.3 Negative prompt para gerador (colar)

```
crown, hat, glasses, sunglasses, necklace, tie, clothing, costume, armor,
accessories, props, playing cards, poker chips, table, felt, money, suit
symbols, text, letters, numbers, logo, watermark, signature, full body,
arms, hands, paws, shoulders, background scenery, painted background, drop
shadow, ground shadow, vignette, frame, halo, outer glow, flat vector,
clipart, sticker, emoji, ui icon, photorealistic, photo, realistic animal,
blender raw render, hyper detailed fur, furry art, anthropomorphic human
body, extreme chibi, anime eyes with many highlights, casino mascot, kids
app style, uniform inner outline, flat pure black, flat pure white,
semi-transparent edges, blurry, low contrast, busy details, cluttered,
symmetrical perfection, stock character
```

---

## 5. Especificação de enquadramento

Canvas de trabalho **1024 × 1024 px**, quadrado, fundo transparente.

| Elemento | Valor no master 1024 | Regra |
|---|---|---|
| **Círculo de recorte** | centro (512, 512), raio 512 | é como o jogo exibe (`border-radius: 50%`) |
| **Círculo seguro** | raio **461** (90%) | **tudo que é essencial vive aqui dentro** |
| **Margem morta** | 61 px (6%) em cada borda | nada encosta na borda absoluta |
| **Largura da cabeça** | **635–737 px** (62–72% do canvas) | mantém o elenco com massa comparável |
| **Linha dos olhos** | banda 38–48% da altura | cada personagem declara a sua |
| → Panda | **45%** (≈ 460 px do topo) | olhos no centro da massa |
| → Sapo | **39%** (≈ 400 px do topo) | domos ficam acima do crânio |
| **Corte do pescoço** | 92% da altura (≈ 942 px) | corte reto, sem desvanecer |
| **Contorno externo** | **8–12 px** | equivale aos 2–3 px do export de 256 |
| **Menor detalhe que precisa ler a 26 px** | **≥ 80 px** | ver o cálculo abaixo |

**De onde vem o mínimo de 80 px.** O export é 256 px e o menor uso real é 26 px — fator de
escala ≈ 0,10. Um traço precisa de pelo menos ~2 px na tela para existir, o que exige ~20 px no
export e **~80 px no master de 1024**. Qualquer detalhe menor do que isso é decoração para o
tamanho grande e não pode carregar informação de reconhecimento.

**Entrega esperada por personagem:**

1. `master/avatar-<id>-neutro.psd` (ou `.kra`/`.clip`) — **em camadas**: crânio, olhos,
   pálpebras, boca, textura, contorno, luz. As expressões futuras dependem disso;
2. `master/avatar-<id>-neutro.png` — 1024 × 1024, transparente, achatado;
3. `export/avatar-<id>-neutro.webp` — 256 × 256, transparente, visualmente lossless,
   ~15–40 KB;
4. `prova/avatar-<id>-prova.png` — folha de contato descrita na seção 6.

Nomes exatamente com os IDs `sapo` e `panda` — são contrato com o servidor.

---

## 6. Critérios objetivos de aprovação em 26 px

Cada personagem só é aprovado se **passar nos seis testes**. Todos são objetivos: ou passa ou não.

### Folha de contato obrigatória

Uma imagem única, entregue junto da arte, contendo:

- **linha 1** — o avatar a 26, 32, 40 e 48 px, sobre Noite Imperial `#140a24`;
- **linha 2** — o avatar a 26 px sobre os quatro gradientes de assento:
  `#ffe27a→#f4c542`, `#7ef0dd→#2dd4bf`, `#c3a6ff→#9b6cff`, `#ff9ecb→#e0338a`;
- **linha 3** — a silhueta preenchida de preto sólido a 26 px;
- **linha 4** — o avatar a 48 px com desfoque gaussiano de 10% do lado.

### Os seis testes

| # | Teste | Critério de aprovação |
|---|---|---|
| **1** | **Espécie a 26 px** | alguém que nunca viu a arte identifica o animal correto |
| **2** | **Personalidade a 26 px** | entre "sereno" e "provocador", a pessoa acerta qual é qual |
| **3** | **Silhueta preta a 26 px** | Sapo e Panda são distinguíveis um do outro **só pela mancha** |
| **4** | **Quatro fundos** | a silhueta permanece fechada e separada nos quatro gradientes; nenhuma parte "vaza" para o fundo |
| **5** | **Desfoque 10%** | o personagem continua reconhecível — prova que o contraste interno sustenta |
| **6** | **Olhos** | a 26 px os olhos ainda são o elemento mais forte do rosto |

### Reprovação automática

- qualquer linha abaixo de 80 px no master carregando informação de reconhecimento;
- contorno ausente, aberto ou com transparência;
- preto `#000000` chapado ou branco `#ffffff` chapado em área grande;
- personagem bilateralmente simétrico;
- qualquer adereço;
- fundo não transparente.

---

## 7. Critérios de consistência entre os dois

Os dois precisam parecer **da mesma fotografia**. Doze verificações — as onze primeiras são
objetivas, a última é de julgamento.

| # | Verificar | Aprovado quando |
|---|---|---|
| 1 | Ângulo da luz principal | idêntico nos dois (cima-esquerda, ≈ 10 h) |
| 2 | Intensidade da luz principal | mesma relação claro/escuro no lado iluminado |
| 3 | Cor e força do preenchimento violeta | mesmo `#9b6cff`, mesma sutileza |
| 4 | Contraluz dourada | presente nos dois, mesma espessura e discrição |
| 5 | Espessura do contorno | 8–12 px nos dois, mesma variação |
| 6 | Cor do contorno | `#140a24` exato nos dois |
| 7 | Tratamento do brilho dos olhos | mesmo formato, mesma posição relativa, mesmo par principal + secundário |
| 8 | Largura da cabeça | ambas dentro de 62–72% do canvas |
| 9 | Corte do pescoço | mesma altura relativa |
| 10 | Nível de detalhe | mesma densidade de informação; nenhum dos dois é visivelmente mais ou menos trabalhado |
| 11 | Faixa de saturação | as cores próprias convivem sem que um pareça lavado ao lado do outro |
| 12 | **Teste do elenco** | lado a lado a 48 px, parecem dois personagens **do mesmo jogo**, e não duas ilustrações de artistas diferentes |

**Teste decisivo da prova de linguagem:** o material do Sapo (úmido, brilhante) e o do Panda
(fosco, felpudo) precisam ser obviamente diferentes **sob a mesma luz**. Se para o pelo do Panda
funcionar for preciso mudar a iluminação, a linguagem não está pronta — porque os outros seis
trazem mais quatro materiais (pelo grosso do leão, penugem da coruja, bico ceroso do tucano,
pelo áspero da capivara) e todos usarão esta mesma luz.

---

## 8. Checklist de transferência para os outros seis

Antes de aprovar Sapo e Panda como linguagem, confirmar que **nada do que os faz funcionar é
exclusivo deles**.

- [ ] O **bloco comum** (seção 1) foi usado **sem uma palavra alterada** nos dois prompts;
- [ ] A luz não foi ajustada para nenhum dos dois — os dois usam o mesmo esquema literal;
- [ ] O contorno não precisou de espessura diferente entre eles;
- [ ] O tratamento de olhos funciona tanto para **olho grande e saliente** (sapo) quanto para
      **olho pequeno dentro de mancha** (panda) — cobre as duas famílias de olho do elenco;
- [ ] O contraste interno funciona tanto **por cor** (sapo) quanto **por valor** (panda) — são
      as duas estratégias que os outros seis vão usar;
- [ ] A regra de assimetria produziu resultados diferentes nos dois (pálpebra × manchas),
      provando que é regra e não maneirismo;
- [ ] A linguagem não depende de material brilhante — o Panda prova isso;
- [ ] A linguagem não depende de contraste extremo — o Sapo prova isso;
- [ ] A pose não precisou ser a mesma (Sapo rotacionado, Panda frontal) para os dois parecerem
      da mesma família;
- [ ] Nenhum dos dois precisou de adereço para ter personalidade;
- [ ] O checklist anti-genérico do brief passa nos dois;
- [ ] O checklist anti-cópia do VERBETE passa no Sapo, com comparação lado a lado.

**Se todos os itens passarem**, a linguagem está provada e os outros seis são produção — o bloco
comum é colado, a ficha de cada personagem (seção 7 do brief) vira o bloco específico, e os
mesmos seis testes de 26 px se aplicam.

**Se algum falhar**, corrigir na dupla antes de tocar nos outros seis. É exatamente por isso que
a produção começa com dois, e não com oito.

---

## 9. O que NÃO fazer nesta etapa

- não produzir os outros seis;
- não produzir expressões além de `neutro`;
- não integrar nada no código;
- não alterar `avatares.ts`, IDs, protocolo ou servidor;
- não commitar assets no repositório antes da aprovação da dupla.
