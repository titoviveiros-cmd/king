# KING — Brief de arte dos 8 avatares

Documento de direção para produzir a coleção inicial definitiva. **Não contém arte.** Contém o
que a arte precisa cumprir para funcionar dentro do jogo que já existe.

Os números aqui não são estimativa: saíram do CSS em produção (`apps/web/src/ui/theme.css`).

---

## 1. Visão da coleção

Oito rostos de bicho antropomorfizados que se sentam à mesa do KING. Cada um é um **arquétipo de
jogador** antes de ser um animal — a pessoa deve olhar e reconhecer alguém que já jogou com ela.

O KING é irmão do VERBETE, não gêmeo. Herda o princípio (rostos de bicho, cartoon 2.5D premium,
carisma, expressividade) e a régua de acabamento. Não herda desenho, pose, roupa, paleta de
personagem nem asset.

O que o KING acrescenta ao DNA da família: **estratégia, tensão, conquista e realeza
contemporânea**. Isso aparece no acabamento e na iluminação — não em fantasiar os bichos de
realeza. A coroa é símbolo de marca e continua rara: **nenhum dos oito usa coroa**.

| ID técnico | Nome visível | Arquétipo na mesa |
|---|---|---|
| `leao` | Leão — O Soberano | quem acha que a mesa é dele |
| `coruja` | Coruja — A Paciente | quem espera doze vazas para dar o bote |
| `raposa` | Raposa — A Calculista | quem conta cartas e sorri quando você erra |
| `macaco` | Macaco — O Bagunceiro | quem provoca antes de todo mundo |
| `panda` | Panda — O Tranquilo | quem leva −160 e ri |
| `tucano` | Tucano — O Anunciador | quem fala primeiro e pensa depois |
| `capivara` | Capivara — A Imperturbável | quem ganha sem levantar a sobrancelha |
| `sapo` | Sapo — O Malandro | quem já sabia o que ia acontecer |

Os IDs técnicos são contrato com o servidor e **não mudam**.

---

## 2. Princípios visuais

**Obrigatório em todos os oito:**

- retrato de **cabeça e pescoço**, sem corpo, sem mãos, sem cartas;
- cartoon **2.5D premium**: volumetria clara, formas cheias, não é vetor chapado nem 3D realista;
- iluminação suave e direcional, com occlusão nas dobras — o `shadow-pop` do DNA;
- materiais legíveis: pelo curto ≠ pluma ≠ pele úmida ≠ penugem;
- olhos expressivos e com brilho especular — é onde mora a personalidade;
- **assimetria intencional** em cada personagem (uma orelha mais baixa, uma cicatriz na
  sobrancelha, um dente torto). Simetria perfeita é o que faz um elenco parecer stock;
- silhueta fechada e reconhecível antes de qualquer detalhe interno.

**Proibido:**

clip-art · emoji · ícone flat genérico · vetor infantil simples · animal realista · furry
hiperdetalhado · personagem de cassino · roupa medieval genérica · excesso de adereços · fundo
desenhado · texto dentro do avatar · coroa (reservada à marca).

**Tom:** provocação sim, agressão não. Um elenco que crianças acham divertido e adultos acham
elegante. Nenhuma personalidade pode virar caricatura ofensiva de pessoa ou cultura.

---

## 3. Regras de silhueta

A regra dura: **dois personagens não podem virar a mesma mancha preta**. Cada um tem uma
estratégia de massa diferente.

| Personagem | Estratégia de silhueta | O que a mancha entrega sozinha |
|---|---|---|
| Leão | **radial** — juba em coroa de raios | maior massa do elenco, contorno irregular |
| Coruja | **trapézio + tufos** — cabeça larga em cima, dois tufos assimétricos | dois picos no topo |
| Raposa | **triangular** — focinho longo apontando, orelhas altas e finas | ponta pra frente |
| Macaco | **orelhas laterais** — dois discos saindo da lateral da cabeça | largura em ambos os lados |
| Panda | **círculo manchado** — massa redonda, orelhas pequenas em cima | o padrão de manchas |
| Tucano | **bico deslocado** — bico ocupa ~40% da largura, cabeça pequena | assimetria horizontal extrema |
| Capivara | **retangular** — cabeça baixa e comprida, orelhas mínimas | bloco horizontal |
| Sapo | **oval baixo + olhos no topo** — olhos ACIMA da linha da cabeça | dois domos saindo por cima |

**Teste de aprovação da silhueta:** preencher os oito de preto sólido a 26 px. Um observador que
conhece o elenco tem de nomear os oito. Se dois forem confundidos, a silhueta ainda não está
pronta — mexer na massa, não no detalhe interno.

---

## 4. Regras de leitura em tamanho pequeno

**O alvo real é 26 px, não 40.** Medido no CSS: os círculos de avatar são `2.1×` a `2.5×` o
token `--ui`, e `--ui` é `clamp(12.5px, …, 19px)`.

| Contexto | Fórmula | Menor | Maior |
|---|---|---|---|
| Lobby (`.sl-av`) e selo do castigo | `2.1 × --ui` | **26 px** | 40 px |
| Linha do Placar (`.pl-av`) | `2.3 × --ui` | 29 px | 44 px |
| Placar final (`.fimlinha .av`) | `2.4 × --ui` | 30 px | 46 px |
| Mesa — adversários e você (`.av`) | `2.5 × --ui` | 31 px | **48 px** |

Consequências que a arte precisa respeitar:

1. **Orçamento de detalhe:** a 26 px, cabem cerca de **três informações faciais**. Escolher
   quais três por personagem e sacrificar o resto (ver campo "detalhe reconhecível" de cada um).
2. **Olhos são o primeiro investimento.** Grandes, com pupila escura e um brilho. É o que
   sobrevive à redução.
3. **Sem linha fina.** Nada abaixo de ~2 px no master de 256 px sobrevive à redução para 26.
4. **Contraste interno alto.** Duas áreas grandes de valor diferente por rosto, no mínimo.
5. **Recorte circular:** o avatar é exibido dentro de `border-radius:50%`. Tudo que importa vive
   no círculo inscrito; orelhas e bico podem tocar a borda mas **não podem depender** do que
   seria cortado num contexto quadrado futuro.

---

## 5. Paleta e iluminação

Paleta do jogo (valores reais em produção):

| Token | Hex | Papel |
|---|---|---|
| Noite Imperial | `#140a24` | fundo do jogo · **cor do contorno dos avatares** |
| Noite 2 / Superfície | `#1c1038` · `#241546` | profundidade |
| Roxo Real | `#6d28d9` | volume, sombra fria |
| Violeta Glow | `#9b6cff` | luz de ambiente |
| Ouro Coroa | `#f4c542` | marca, vitória |
| Turquesa | `#2dd4bf` | positivo, seguro |
| Magenta | `#e0338a` | perigo, o King |

**Regra de cor dos personagens:** cada bicho mantém a **cor natural da espécie**. Não tingir o
elenco de roxo e dourado — a identidade KING entra pelo acabamento, pela luz e pela linguagem, não
por pintar oito animais da mesma cor.

**Esquema de luz — igual para os oito, para o elenco parecer da mesma fotografia:**

- **luz principal** quente, vinda de cima e da esquerda (≈ 10 h), suave;
- **luz de preenchimento** fria em Violeta Glow, vinda da direita e de baixo, fraca — é ela que
  amarra o personagem ao mundo do KING;
- **contraluz** discreta em Ouro Coroa na borda superior, muito sutil: dá o "acabamento de
  videogame" sem colocar coroa em ninguém;
- **occlusão** nas dobras (juba, pálpebras, comissura da boca), nunca contorno preto uniforme.

---

## 6. Comportamento sobre os fundos de assento

O avatar é desenhado **dentro** do círculo colorido do assento. Os quatro fundos reais são
gradientes, não cores chapadas:

| Assento | Gradiente real |
|---|---|
| s0 | `#ffe27a → #f4c542` (dourado) |
| s1 | `#7ef0dd → #2dd4bf` (turquesa) |
| s2 | `#c3a6ff → #9b6cff` (violeta) |
| s3 | `#ff9ecb → #e0338a` (magenta) |

**Regra técnica obrigatória:** todo personagem leva um **contorno próprio de 2–3 px (no master de
256) em Noite Imperial `#140a24`**, fechado em volta da silhueta. É isso — e só isso — que
garante leitura nos quatro fundos sem depender de nenhum deles. Nenhuma transparência de borda,
nenhum brilho externo suave que suma em fundo claro.

**Dois riscos concretos de colisão de cor, medidos contra os gradientes acima:**

- **Leão sobre o assento dourado (s0):** juba âmbar/ocre encosta em `#f4c542`. Mitigação: puxar
  a juba para um ocre mais quente e escuro e reforçar a occlusão entre juba e rosto.
- **Tucano sobre o assento dourado (s0):** bico laranja-amarelo encosta no mesmo dourado.
  Mitigação: bico com gradiente laranja→coral e um keyline escuro na base do bico.

Nenhum outro par tem conflito relevante: Panda (preto/branco), Sapo (verde) e Coruja
(marrom-creme) são seguros nos quatro; Raposa (laranja-avermelhado) e Macaco (marrom quente)
separam bem inclusive do magenta.

**Teste de aprovação:** cada personagem renderizado a 26 px sobre os quatro gradientes. Se em
algum deles a silhueta "vaza", o contorno ou o valor interno estão errados.

---

## 7. Brief individual

Cada ficha traz os 18 campos pedidos.

---

### 7.1 `leao` — **Leão, O Soberano**

1. **Espécie:** leão adulto.
2. **Nome conceitual:** O Soberano.
3. **Personalidade:** nobre, confiante, levemente vaidoso. Não é arrogante — é alguém que
   simplesmente nunca duvidou de si.
4. **Arquétipo na mesa:** quem já se sentou achando que a mesa é dele, e às vezes é.
5. **Expressão facial (neutro):** sobrancelha erguida, meio sorriso fechado, queixo levemente
   elevado. Olha *ligeiramente para baixo* na direção do observador.
6. **Formato da cabeça:** círculo cheio inscrito numa **coroa radial de juba** — a maior massa
   do elenco, ocupando quase todo o círculo do assento.
7. **Olhos:** amendoados, íris âmbar-mel, pálpebra superior pesada (dá o ar entediado de quem já
   viu tudo). Brilho especular único e alto.
8. **Boca/focinho:** focinho curto e largo, nariz escuro em triângulo arredondado; boca em linha
   com um canto elevado.
9. **Elementos distintivos:** juba em mechas grossas e **assimétricas** — mais volume à
   esquerda; uma falha/cicatriz discreta na sobrancelha direita.
10. **Pose/corte:** frontal com 5° de rotação, queixo alto. Corte no meio do pescoço.
11. **Iluminação:** principal quente de cima-esquerda batendo no topo da juba; violeta de
    preenchimento na direita; contraluz dourada muito sutil nas pontas da juba.
12. **Materialidade:** pelo curto e liso no rosto, contrastando com a juba em mechas de pelo
    grosso e fosco. O contraste de textura entre os dois é metade do personagem.
13. **Acento visual:** âmbar dourado quente — mas **mais escuro e alaranjado** que o Ouro Coroa,
    para não colidir com o assento s0.
14. **Detalhe reconhecível:** a juba assimétrica. Se sobrar só ela, é o Leão.
15. **Risco a evitar:** virar o leão-mascote genérico de time esportivo, ou insinuar coroa na
    juba. A juba é cabelo, não adorno real.
16. **A 26 px:** massa radial + rosto claro no centro + olhos pesados. Três informações, e chega.
17. **Em tamanho grande:** mechas individuais, textura fosca da juba, brilho úmido do nariz,
    cicatriz da sobrancelha.
18. **Reações:**
    - neutro — meio sorriso, queixo alto;
    - vitória — olhos fechados de satisfação, sorriso amplo, juba levemente eriçada;
    - derrota — sobrancelhas juntas, boca reta, olhar desviado para o lado (nunca choro);
    - provocação — uma sobrancelha sobe, canto da boca sobe do lado oposto;
    - surpresa — pálpebras totalmente abertas pela primeira vez; o efeito cômico é justamente o
      contraste com o olhar pesado padrão.

---

### 7.2 `coruja` — **Coruja, A Paciente**

1. **Espécie:** coruja (tipo suindara/orelhuda, com tufos).
2. **Nome conceitual:** A Paciente.
3. **Personalidade:** observadora, estratégica, tranquila. Fala pouco, vê tudo.
4. **Arquétipo na mesa:** quem passa a mão inteira quieta e leva as duas últimas vazas.
5. **Expressão facial (neutro):** pálpebras a meio mastro, olhar fixo e direto. Serenidade que
   incomoda um pouco.
6. **Formato da cabeça:** trapézio de base estreita — larga em cima, afinando no queixo — com
   **dois tufos assimétricos** no topo. Dois picos na silhueta.
7. **Olhos:** os **maiores do elenco**. Círculos amplos, íris âmbar-claro, pupila grande e
   escura, disco facial em penugem clara emoldurando cada olho.
8. **Bico:** pequeno, curvo, cinza-claro, quase escondido entre os discos faciais. Deliberadamente
   discreto — os olhos é que mandam.
9. **Elementos distintivos:** os dois discos faciais concêntricos; tufo esquerdo mais alto que o
   direito; penugem eriçada no contorno do rosto.
10. **Pose/corte:** rigorosamente frontal, imóvel. É o único do elenco totalmente de frente — a
    imobilidade é o personagem.
11. **Iluminação:** principal quente suave em cima; violeta de preenchimento marcando a penugem
    do contorno; contraluz mínima, para preservar a atmosfera calma.
12. **Materialidade:** penugem macia e felpuda no rosto; penas de contorno mais definidas nos
    tufos. Nada brilhante — a coruja é fosca.
13. **Acento visual:** marrom-acinzentado com creme, âmbar nos olhos.
14. **Detalhe reconhecível:** os dois discos faciais gigantes com o par de olhos.
15. **Risco a evitar:** virar coruja de logotipo de escola/livraria. A solução é a assimetria dos
    tufos e a penugem irregular.
16. **A 26 px:** dois picos no topo + dois círculos claros enormes. Insubstituível.
17. **Em tamanho grande:** penas individuais no disco facial, textura felpuda, reflexo duplo nos
    olhos.
18. **Reações:**
    - neutro — pálpebras a meio mastro;
    - vitória — olhos fechados em arcos e uma leve inclinação de cabeça (nunca comemoração
      grande — a graça é a contenção);
    - derrota — uma piscada lenta, tufos caídos;
    - provocação — cabeça gira 15° mantendo o olhar travado no observador;
    - surpresa — olhos **arregalados ao máximo** e tufos eretos. A maior variação de leitura do
      elenco inteiro — use isso a favor.

---

### 7.3 `raposa` — **Raposa, A Calculista**

1. **Espécie:** raposa-vermelha.
2. **Nome conceitual:** A Calculista.
3. **Personalidade:** esperta, analítica, sorriso de canto. Está sempre dois lances à frente.
4. **Arquétipo na mesa:** quem conta cartas de cabeça e sorri quando você erra.
5. **Expressão facial (neutro):** olhos semicerrados, sorriso de canto do lado direito,
   sobrancelha esquerda levemente erguida.
6. **Formato da cabeça:** **triângulo apontando para a frente** — focinho longo e fino, orelhas
   altas e pontudas em triângulo.
7. **Olhos:** amendoados e inclinados, íris âmbar-esverdeada, pupila em fenda suave (não
   felina agressiva). Olhar de canto.
8. **Focinho:** longo e afilado, nariz pequeno e escuro na ponta, boca fina com o canto direito
   elevado. Bochecha branca contrastando com o dorso ruivo.
9. **Elementos distintivos:** máscara facial de duas cores — ruivo no topo, branco creme no
   focinho e peito; ponta escura nas orelhas.
10. **Pose/corte:** 3/4 acentuado (≈ 20°), com o olhar voltando para o observador. É a única em
    3/4 forte — reforça a ideia de quem observa de lado.
11. **Iluminação:** principal quente na testa e no dorso do focinho; violeta de preenchimento na
    bochecha em sombra; contraluz dourada na orelha de trás.
12. **Materialidade:** pelo curto e sedoso, com direção clara no dorso do focinho; penugem mais
    solta no peito.
13. **Acento visual:** ruivo-alaranjado saturado com creme.
14. **Detalhe reconhecível:** o triângulo do focinho com o sorriso de canto.
15. **Risco a evitar:** raposa "fofa de rede social" e raposa de vilão. Fica no meio: esperta e
    simpática.
16. **A 26 px:** ponta triangular + duas orelhas + a linha do sorriso torto.
17. **Em tamanho grande:** direção do pelo, vibrissas finas, gradiente ruivo→creme, umidade do
    nariz.
18. **Reações:**
    - neutro — sorriso de canto;
    - vitória — olhos fechados em arco, sorriso amplo mostrando dentes pequenos;
    - derrota — orelhas baixam, boca reta, olhar para baixo e para o lado;
    - provocação — pisca **um olho** (a única do elenco que pisca — é a assinatura dela);
    - surpresa — orelhas eretas, olhos abertos, focinho recuado.

---

### 7.4 `macaco` — **Macaco, O Bagunceiro**

1. **Espécie:** macaco-prego / capuchinho.
2. **Nome conceitual:** O Bagunceiro.
3. **Personalidade:** irreverente, divertido, social. Energia alta, sem maldade.
4. **Arquétipo na mesa:** quem manda "Essa doeu 😅" antes de você terminar de recolher a vaza.
5. **Expressão facial (neutro):** já sorrindo, boca aberta mostrando dentes, sobrancelhas altas.
   É o único que **já começa rindo**.
6. **Formato da cabeça:** círculo com **duas orelhas grandes e circulares saindo da lateral** —
   a única silhueta com massa saindo horizontalmente dos dois lados.
7. **Olhos:** redondos, muito móveis, íris castanha escura, brilho grande e deslocado (dá o ar
   travesso). Pálpebras altas.
8. **Focinho:** achatado e claro, boca larga e expressiva, sempre com alguma abertura.
9. **Elementos distintivos:** topete de pelo escuro no alto da cabeça, desalinhado; máscara
   facial clara em contraste com o pelo escuro; uma orelha visivelmente mais alta.
10. **Pose/corte:** frontal com inclinação de cabeça de 8° e ombros insinuados — o único com
    alguma diagonal no corte, para sugerir movimento.
11. **Iluminação:** principal quente no topete e na testa; violeta forte de preenchimento (ele é
    o mais "iluminado do ambiente" do elenco); contraluz nas bordas das orelhas.
12. **Materialidade:** pelo curto e desarrumado no crânio; pele lisa e clara no rosto e nas
    orelhas.
13. **Acento visual:** marrom quente com rosto em bege claro.
14. **Detalhe reconhecível:** as duas orelhas laterais + a boca aberta rindo.
15. **Risco a evitar:** macaco de desenho antigo com estereótipo caricato. Manter proporções de
    primata reais e expressão amigável — nunca zombeteira de forma agressiva.
16. **A 26 px:** silhueta larga com dois discos laterais + a mancha clara do rosto.
17. **Em tamanho grande:** fios do topete, textura da pele das orelhas, dentes individuais.
18. **Reações:**
    - neutro — já rindo;
    - vitória — gargalhada, olhos em arco, cabeça jogada para trás;
    - derrota — boca em "o" e sobrancelhas caídas — decepção cômica, nunca tristeza real;
    - provocação — língua de fora e um olho fechado;
    - surpresa — boca escancarada, olhos redondos ao máximo.

---

### 7.5 `panda` — **Panda, O Tranquilo**

1. **Espécie:** panda-gigante.
2. **Nome conceitual:** O Tranquilo.
3. **Personalidade:** sereno, simpático, difícil de tirar do eixo.
4. **Arquétipo na mesa:** quem leva −160 e ri junto com quem aplicou.
5. **Expressão facial (neutro):** olhos calmos e semicerrados, meio sorriso pequeno e genuíno.
6. **Formato da cabeça:** **círculo generoso** com duas orelhas pequenas e arredondadas no topo.
   Massa simples, quase geométrica.
7. **Olhos:** pequenos e escuros **dentro** das manchas oculares pretas — as manchas fazem o
   trabalho de tamanho aparente. Brilho branco compensa o escuro.
8. **Focinho:** curto, nariz preto arredondado, boca pequena com cantos elevados.
9. **Elementos distintivos:** o **padrão de manchas** — orelhas pretas, manchas oculares
   arredondadas e ligeiramente diferentes entre si, resto do rosto branco. Maior contraste de
   valor do elenco.
10. **Pose/corte:** frontal, estático, centralizado. Estabilidade é o personagem.
11. **Iluminação:** principal quente suave no topo do crânio; violeta de preenchimento nas
    laterais brancas (é onde a luz fria mais aparece e amarra o elenco); contraluz dourada
    discreta nas orelhas.
12. **Materialidade:** pelo denso e macio, levemente felpudo no contorno. Preto profundo mas
    **nunca chapado** — precisa de variação para não virar buraco.
13. **Acento visual:** branco e carvão, com o violeta do ambiente nas sombras.
14. **Detalhe reconhecível:** o padrão de manchas. Funciona mesmo desfocado.
15. **Risco a evitar:** virar mascote de marca genérica. A saída é a assimetria das manchas e a
    expressão específica — e **preto com variação de valor**, nunca `#000` chapado.
16. **A 26 px:** o melhor do elenco. Duas manchas escuras + orelhas escuras + campo branco.
17. **Em tamanho grande:** textura felpuda no limite entre preto e branco, brilho úmido do nariz.
18. **Reações:**
    - neutro — meio sorriso;
    - vitória — olhos fechados em arco, sorriso largo, cabeça levemente inclinada;
    - derrota — dá de ombros com a cabeça; sobrancelhas em telhado, boca ainda sorrindo (**é o
      único que sorri na derrota** — é a piada do personagem);
    - provocação — um olho fechado, sorriso pequeno e um pouco mais largo;
    - surpresa — olhos redondos, orelhas eretas, boca em "o" pequeno.

---

### 7.6 `tucano` — **Tucano, O Anunciador**

1. **Espécie:** tucano-toco.
2. **Nome conceitual:** O Anunciador.
3. **Personalidade:** expansivo, comunicativo, expressivo. Fala primeiro, pensa depois — e às
   vezes acerta.
4. **Arquétipo na mesa:** quem anuncia o trunfo em voz alta antes de olhar direito a mão.
5. **Expressão facial (neutro):** bico ligeiramente aberto, sobrancelhas altas, olho arregalado.
   Sempre no meio de dizer alguma coisa.
6. **Formato da cabeça:** cabeça **pequena** dominada por um **bico enorme** que ocupa ~40% da
   largura e aponta para a direita. Assimetria horizontal extrema.
7. **Olhos:** grandes, redondos, com anel de pele nua colorida ao redor (turquesa-claro,
   conectando ao universo do jogo sem tingir o bicho). Pupila pequena e alta = animação.
8. **Bico:** o personagem inteiro. Gradiente do laranja quente à base para coral/vermelho na
   ponta, com uma faixa escura na base. Levemente curvo, com um lascado discreto na ponta
   superior (assimetria intencional).
9. **Elementos distintivos:** o bico, o anel ocular turquesa e o contraste peito-amarelo /
   plumagem-preta.
10. **Pose/corte:** perfil de 3/4 forte (≈ 35°) para o bico ler inteiro. É o único quase de
    perfil — necessidade de silhueta, não escolha estética.
11. **Iluminação:** principal quente ao longo do dorso do bico (mostra a curvatura); violeta de
    preenchimento na plumagem preta, que sem isso vira mancha morta; contraluz dourada na nuca.
12. **Materialidade:** bico liso, duro e levemente ceroso — o único material rígido e brilhante
    do elenco; plumagem sedosa e fosca; pele nua ao redor do olho.
13. **Acento visual:** laranja-coral no bico, amarelo no peito, turquesa no anel ocular.
14. **Detalhe reconhecível:** o bico. Nada mais é necessário.
15. **Risco a evitar:** virar o tucano de caixa de cereal, e o bico colidir com o assento
    dourado. Mitigação já definida: gradiente laranja→coral e keyline escuro na base.
16. **A 26 px:** a silhueta mais imediata do elenco — massa deslocada para um lado.
17. **Em tamanho grande:** textura cerosa do bico, serrilhado do corte, brilho especular
    alongado, penas individuais na nuca.
18. **Reações:**
    - neutro — bico entreaberto;
    - vitória — bico bem aberto, cabeça para trás, olho fechado em arco;
    - derrota — bico fechado (o silêncio dele é a piada), olho semicerrado;
    - provocação — bico apontando diretamente para o observador, olho estreito;
    - surpresa — olho arregalado ao máximo, bico aberto na vertical.

---

### 7.7 `capivara` — **Capivara, A Imperturbável**

1. **Espécie:** capivara.
2. **Nome conceitual:** A Imperturbável.
3. **Personalidade:** plácida, segura, quase impossível de abalar.
4. **Arquétipo na mesa:** quem ganha sem levantar a sobrancelha e sem comemorar.
5. **Expressão facial (neutro):** olhos pequenos e serenos, boca em linha reta com um
   micro-sorriso quase imperceptível. **Serenidade absoluta.**
6. **Formato da cabeça:** **retângulo horizontal** de cantos arredondados — focinho achatado e
   comprido, orelhas mínimas e arredondadas. A massa mais baixa e larga do elenco.
7. **Olhos:** pequenos, escuros, bem separados e posicionados alto na cabeça. Pálpebras pesadas.
   Brilho pequeno e único.
8. **Focinho:** largo, achatado no topo, narinas altas e bem separadas. Boca larga e reta.
9. **Elementos distintivos:** a proporção — nenhum outro personagem é mais largo que alto; pelo
   curto e espetado com direção clara; uma pequena mecha rebelde entre as orelhas.
10. **Pose/corte:** frontal, ligeiramente abaixo da linha do olhar do observador (a única vista
    de baixo), o que reforça a placidez.
11. **Iluminação:** principal quente no topo do focinho; violeta de preenchimento amplo no
    volume do corpo; contraluz dourada mínima.
12. **Materialidade:** pelo curto, duro e espetado, com direção visível — o material mais áspero
    do elenco, em contraste direto com a penugem da coruja.
13. **Acento visual:** marrom-areia quente, com pontas de pelo mais claras.
14. **Detalhe reconhecível:** o retângulo horizontal com olhos altos e pequenos.
15. **Risco a evitar:** virar o meme da capivara. **Nada de óculos, nada de acessório, nada de
    piada visual.** A graça é a placidez levada a sério — ela é elegante, não engraçada.
16. **A 26 px:** bloco largo e baixo. Só ela tem essa proporção.
17. **Em tamanho grande:** fios espetados individuais, textura do focinho, narinas úmidas.
18. **Reações:**
    - neutro — serenidade;
    - vitória — o micro-sorriso cresce **um pouco**; olhos fecham devagar. Nada mais. A contenção
      é a comemoração;
    - derrota — uma piscada lenta. Idêntica ao neutro, de propósito;
    - provocação — sobrancelha erguida um milímetro e olhar direto — o mínimo possível;
    - surpresa — **a única reação grande dela**: olhos arregalados e orelhas eretas. Funciona
      justamente porque tudo o mais é contido.

---

### 7.8 `sapo` — **Sapo, O Malandro** ⭐

*Ponte criativa com o VERBETE — mesmo espírito de família, personagem inteiramente próprio do
KING. Nenhum elemento do sapo do VERBETE pode ser reaproveitado: nem pose, nem cor, nem forma de
olho, nem adereço.*

1. **Espécie:** sapo/perereca de olhos grandes.
2. **Nome conceitual:** O Malandro.
3. **Personalidade:** esperto, irreverente, confiante, muito à vontade à mesa. Provocador
   simpático — nunca agressivo.
4. **Arquétipo na mesa:** quem transmite "eu já sabia" no exato instante em que a vaza vira.
5. **Expressão facial (neutro):** **sorriso de canto largo**, olhar vivo e ligeiramente de lado,
   uma pálpebra mais baixa que a outra. Malícia amigável.
6. **Formato da cabeça:** **oval largo e baixo**, com os **olhos acima da linha do crânio** —
   dois domos saindo por cima. É a única silhueta com massa *saliente no topo em cúpula*.
7. **Olhos:** grandes, esféricos e salientes, íris dourada com pupila horizontal, pálpebra
   superior espessa. **Assimetria obrigatória:** a pálpebra esquerda mais baixa — é o que dá a
   malandragem sem precisar de acessório.
8. **Boca:** a **mais larga do elenco**, atravessando quase toda a cabeça, com o canto direito
   claramente elevado. A linha da boca é o segundo elemento mais reconhecível dele.
9. **Elementos distintivos:** olhos em cúpula + boca larguíssima + textura de pele levemente
   úmida com pintas irregulares no dorso; papada discreta que pulsa nas expressões.
10. **Pose/corte:** frontal com 10° de rotação e queixo baixo, olhando levemente de baixo para
    cima — a pose de quem está confortável e não vai levantar.
11. **Iluminação:** principal quente com **especular forte e concentrado** nos domos oculares e
    no alto do dorso (é a leitura de "úmido"); violeta de preenchimento na papada; contraluz
    dourada nas bordas dos olhos.
12. **Materialidade:** pele lisa, úmida, levemente translúcida nas bordas — **o único material
    brilhante e orgânico do elenco**, em oposição direta ao bico duro do tucano e ao pelo áspero
    da capivara.
13. **Acento visual:** verde-esmeralda com barriga creme e íris dourada. O verde é a única cor
    do elenco que não conflita com nenhum dos quatro fundos de assento — vantagem real.
14. **Detalhe reconhecível:** os dois domos oculares no topo da silhueta, com a boca larga
    embaixo. Inconfundível a qualquer tamanho.
15. **Risco a evitar:** **parecer o sapo do VERBETE** (checklist da seção 14); virar sapo
    "nojento" de conto de fadas; ou virar mascote de refrigerante. O caminho é elegância —
    é um malandro charmoso, não um bufão.
16. **A 26 px:** duas cúpulas no topo + linha larga da boca. Das melhores leituras do elenco.
17. **Em tamanho grande:** microtextura da pele, pintas irregulares, translucidez nas bordas da
    papada, reflexo duplo nos olhos esféricos.
18. **Reações:**
    - neutro — sorriso de canto;
    - vitória — boca aberta de orelha a orelha, olhos fechados em arco, papada inflada;
    - derrota — boca em linha reta, olhos rolando para cima — irritação bem-humorada, nunca
      tristeza;
    - provocação — **a expressão-assinatura da coleção inteira**: uma pálpebra baixa, sorriso
      máximo de canto, queixo levemente para cima;
    - surpresa — olhos esféricos ao máximo, boca em "o" pequeno e papada retraída.

---

## 8. Matriz comparativa de personalidade

| | Energia | Fala | Reage a perder | Contenção | Ritmo |
|---|---|---|---|---|---|
| Leão | alta | pouco, decide | orgulho ferido | média | pausado |
| Coruja | baixa | quase nada | indiferente | **máxima** | lento |
| Raposa | média | comenta | analisa | alta | preciso |
| Macaco | **máxima** | o tempo todo | comédia | **mínima** | acelerado |
| Panda | baixa | pouco | ri junto | alta | lento |
| Tucano | alta | **anuncia tudo** | cala | baixa | irregular |
| Capivara | **mínima** | quase nada | nem pisca | **máxima** | parado |
| Sapo | média-alta | provoca | irritação bem-humorada | média | malemolente |

Sem repetição: os oito ocupam posições distintas. Os pares mais próximos (Coruja/Capivara em
contenção, Macaco/Tucano em energia) separam-se pelo **ritmo** e pela silhueta.

## 9. Matriz comparativa de silhueta

| | Proporção | Massa saliente | Onde estão os olhos | Textura dominante |
|---|---|---|---|---|
| Leão | alto ≈ largo | radial (juba) | centro | pelo grosso fosco |
| Coruja | mais alto | dois picos no topo | centro, **enormes** | penugem felpuda |
| Raposa | alongado à frente | ponta (focinho) | alto, inclinados | pelo sedoso |
| Macaco | **mais largo** | dois discos laterais | centro | pelo curto + pele lisa |
| Panda | círculo | orelhas pequenas no topo | centro, **em manchas** | pelo denso macio |
| Tucano | largo assimétrico | **bico lateral** | alto, deslocado | bico ceroso rígido |
| Capivara | **largo e baixo** | nenhuma | **alto e separados** | pelo áspero espetado |
| Sapo | **oval baixo** | **cúpulas no topo** | **acima do crânio** | pele úmida brilhante |

Cada linha é única em pelo menos duas colunas. As texturas cobrem seis materiais distintos.

## 10. Expressões futuras

O design-base precisa **suportar sete estados sem redesenho**: neutro, feliz, tensão, provocação,
derrota, surpresa, vitória. Nesta fase produzir **apenas `neutro`**.

Regras de construção que garantem a expansão:

1. **Cabeça, olhos e boca em camadas separadas** no arquivo-fonte. Trocar expressão = trocar as
   camadas de olho e boca, nunca redesenhar o crânio.
2. **Sobrancelhas/pálpebras como elemento independente**, mesmo em quem não tem sobrancelha
   (coruja, tucano, sapo usam a pálpebra superior).
3. **Contorno da cabeça imutável** entre expressões — a silhueta é a identidade e não pode
   mudar de estado para estado.
4. Cada personagem já tem, nas fichas acima, as cinco reações descritas. São a especificação da
   expansão, não sugestão.
5. **Amplitude é característica:** Macaco e Tucano variam muito; Capivara e Coruja variam quase
   nada. Isso é personalidade, não inconsistência — e faz a surpresa da Capivara valer ouro.

## 11. Especificação técnica dos assets

Dimensionada pelos tamanhos **reais** medidos na seção 4 (26–48 px CSS).

| Item | Especificação | Por quê |
|---|---|---|
| **Master** | 1024 × 1024 px, camadas preservadas | permite qualquer uso futuro sem refazer |
| **Export de jogo** | **256 × 256 px**, quadrado | cobre 48 px a DPR 3 (144 px) e telas de perfil futuras a 120 px em DPR 2 |
| **Variantes 1x/2x/3x** | **não são necessárias** | um único 256 já supera a maior necessidade; três arquivos por avatar seriam 3× o peso sem ganho |
| **Proporção** | 1:1 | o contêiner é `border-radius:50%` |
| **Área segura** | tudo essencial dentro do círculo inscrito (raio 45% do lado); 6% de margem morta na borda | o recorte é circular, mas um uso quadrado futuro não pode cortar orelha ou bico |
| **Fundo** | **transparente** (o assento fornece a cor) | a mesma arte serve os quatro assentos |
| **Contorno** | 2–3 px no master de 256, `#140a24`, fechado | garante leitura nos quatro gradientes |
| **Formato** | **WebP** com qualidade 90 | suportado em todos os alvos (Chrome, Safari 14+, WKWebView, Android WebView); ~8–15 KB por arquivo |
| **Fallback** | PNG-32 apenas se surgir alvo sem WebP | hoje não existe alvo assim |
| **Peso total** | alvo **< 120 KB** para os 8 | são carregados na entrada da sala |
| **Naming** | `avatar-<id>-<expressao>.webp` — ex.: `avatar-sapo-neutro.webp` | `<id>` é exatamente o ID técnico; casa com o conjunto fechado sem tabela de tradução |
| **Local** | `apps/web/public/avatares/` | servido como estático; entra no `dist` e no `cap sync` sem configuração |

**Estratégia por plataforma:** o mesmo arquivo serve Web, Capacitor, iOS e Android — o Capacitor
empacota o `dist` do Vite, então não existe pipeline separado. Nenhum asset nativo adicional é
necessário para os avatares (ícone e splash são outro trabalho).

## 12. Recomendações para integração

Quando a arte existir, a troca é **um arquivo**:

- `apps/web/src/ui/avatares.ts` — substituir o campo `glifo` (emoji) por `arquivo` (caminho) e
  trocar o `<span>{glifo}</span>` por `<img>` nos três pontos de render (Sala, Mesa, Placar);
- manter `rotulo` e `persona` como estão — são a acessibilidade e o brief;
- remover a flag `aproximado`, que só existe enquanto houver emoji substituto;
- **nada muda** no protocolo, no servidor, nos IDs ou nos testes de contrato.

Cuidados na integração:

1. `<img>` precisa de `alt` = `rotulo` (hoje o `aria-label` já cumpre esse papel);
2. pré-carregar os oito na entrada do lobby — o avatar não pode aparecer depois do nome;
3. `image-rendering` padrão; nada de `pixelated`;
4. o filtro `grayscale(.5)` do estado "ausente" já se aplica ao `<img>` sem mudança.

## 13. Recomendação para marketing

Força visual para ícone, splash e capturas de loja — **não** é escolha de mascote. "O Rei"
continua sendo o mascote, personagem separado.

| Posição | Personagem | Por quê |
|---|---|---|
| **1º** | **Sapo — O Malandro** | silhueta mais original do elenco (olhos em cúpula), verde não conflita com nenhum fundo, expressão-assinatura, e é a ponte afetiva com o VERBETE |
| **2º** | **Leão — O Soberano** | maior massa e mais imediato como "rei" sem usar coroa; funciona em ícone monocromático |
| **3º** | **Tucano — O Anunciador** | a silhueta mais reconhecível a distância; cor vibrante que salta na miniatura da loja |

**Sugestão de composição** para ícone/splash: **Sapo + Leão**, meio-corpo, sobre Noite Imperial,
com a coroa da marca acima e entre os dois — a coroa como elemento de marca, não como adereço de
personagem. Preserva a raridade da coroa e diz "jogo de cartas com personagens" numa olhada.

## 14. Checklist anti-genérico

Reprovar a arte se qualquer item falhar:

- [ ] os 8 preenchidos de preto a 26 px são nomeáveis por quem conhece o elenco;
- [ ] nenhum personagem é bilateralmente simétrico;
- [ ] cada um tem ao menos **uma** imperfeição intencional (cicatriz, tufo torto, bico lascado, mecha rebelde, pálpebra desigual);
- [ ] as texturas são distinguíveis entre si (pelo grosso ≠ penugem ≠ pele úmida ≠ bico ceroso ≠ pelo áspero);
- [ ] nenhum usa acessório, óculos, chapéu ou coroa;
- [ ] nenhum tem contorno uniforme de espessura constante como único recurso de forma;
- [ ] o esquema de luz é **o mesmo** nos oito (parecem da mesma fotografia);
- [ ] nenhum foi tingido de roxo/dourado para "parecer KING";
- [ ] nenhuma expressão neutra é inexpressiva — todas dizem algo;
- [ ] os oito legíveis sobre os quatro gradientes de assento a 26 px;
- [ ] nenhum é uma piada visual (especialmente a Capivara);
- [ ] nenhum some quando o rosto é desfocado a 10% — o contraste interno sustenta.

## 15. Checklist anti-cópia do VERBETE

Aplicar a **todos** os oito, com atenção redobrada ao Sapo:

- [ ] nenhum asset, camada, curva ou paleta importada do VERBETE;
- [ ] o **Sapo do KING** difere do sapo do VERBETE em: formato do olho, posição do olho, linha da
      boca, cor de pele, pose e acabamento — e a diferença é óbvia lado a lado para quem conhece
      os dois;
- [ ] nenhum personagem repete a pose característica dos avatares do VERBETE;
- [ ] o Livro Mascote e qualquer variação dele estão ausentes;
- [ ] o wordmark, o tile e a tipografia do VERBETE não aparecem;
- [ ] os valores exatos de hue do VERBETE não são reutilizados — o KING usa a derivação imperial;
- [ ] o que é herdado é **método** (volumetria, shadow-pop, glow controlado, microhumor,
      acabamento de videogame), nunca forma;
- [ ] alguém que joga os dois diz "é da mesma casa" e **não** diz "é o mesmo desenho".

---

## Resumo das decisões que este brief toma

1. O alvo de leitura é **26 px**, não 40 — medido no CSS.
2. **Contorno em Noite Imperial** em todos, obrigatório: é o que resolve os quatro fundos.
3. **Nenhuma coroa** em nenhum personagem — a coroa é da marca.
4. **Cores naturais** por espécie; a identidade KING vem da luz e do acabamento.
5. Dois conflitos de cor identificados e mitigados: **Leão** e **Tucano** sobre o assento dourado.
6. **Um único tamanho de export (256 px)** — variantes de densidade seriam peso sem ganho.
7. Nesta fase produz-se **só a expressão neutra**, com o arquivo em camadas preparado para sete.
8. **Sapo + Leão** para marketing, com a coroa da marca entre os dois.
