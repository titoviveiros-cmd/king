# KING — Roteiro de ativação dos cosméticos (Entrega B)

> **NADA DESTE ROTEIRO FOI EXECUTADO.** Production não tem a tabela, as funções, o servidor nem a web
> dos cosméticos. Cada passo abaixo exige **autorização própria** do Tito, e cada um tem um critério
> de PARAR.

## O que existe hoje em Production

Introspecção **somente leitura** do projeto `dwkpkpmfsqvyarjtcmjd`, em 17/11/2026, por
`supabase gen types`: um GET de esquema, sem SQL e sem criar papel.

| Migração do repositório | Em Production |
|---|---|
| `20260830120000_identidade` | ✅ `players` |
| `20260925120000_progresso` | ✅ `progresso`, `xp_eventos`, `meu_progresso`, `nivel_de`, `xp_para_nivel`, `creditar_partida`, `partidas` |
| `20261001120000_sequencia` | ✅ `sequencia_*`, `dia_de_sao_paulo`, colunas da sequência em `meu_progresso` |
| `20261025120000_cadastro_so_convidado` | ✅ `king_antes_de_criar_usuario` |
| `20261025130000_credito_com_conta_excluida` | ✅ `contas_excluidas` |
| `20261026120000_retencao_das_lapides` | ✅ `expurgo_das_lapides`, `expurgar_lapides` |
| `20261117120000_cosmeticos` | ❌ **ausente**, como deve ser |
| `20261118120000_cosmeticos_mesa` (a toalha) | ❌ **ausente**, como deve ser |

Ficaram de fora dessa leitura:
- **Papéis e GRANTs:** a introspecção não os mostra. Quem confirma é o **checkpoint 1**.
- **Funções de gatilho:** também não aparecem na introspecção.

`meu_progresso` já tem `player_id`, que é a coluna que a web nova usa para separar a celebração
por conta.

## A ordem segura: banco → servidor → web

Cada camada nova **tolera** a anterior ausente. Por isso, parar entre dois passos nunca quebra o
jogo.

| Estado intermediário | O que acontece | Prova |
|---|---|---|
| **Banco** novo, servidor e web antigos | Nada muda para ninguém: o servidor antigo não chama a porta da sala, e a web antiga não lê a tabela. | rollout R2/R5 |
| Banco e **servidor** novos, web antiga | A web antiga ignora os campos `moldura`/`coroa` do assento. Ninguém tem o botão da coroa, porque só a web nova o mostra. | `clienteKing`, homologação (D) |
| Servidor novo **sem** banco novo (ordem errada) | A consulta falha. O servidor registra só o código do erro e a mesa segue **sem cosméticos**. | `cosmeticos.test.ts` "BANCO FORA" |
| **Web** nova, servidor antigo | A vitrine funciona (é só banco). A moldura não aparece na mesa e o botão da coroa não aparece (o assento vem sem `coroa`). | `cosmeticos.spec`, unidade |
| Web nova **sem** banco novo | `cosmeticos_equipados` responde 404, e a vitrine não aparece. | `cosmeticos.spec` "sem migração" |

### Passo 1 — banco (Tito, SQL Editor)

1. Rodar `supabase/rollout/cosmeticos-checkpoint-1-antes.sql` (**só leitura**). Esperado:
   - `pronto_para_aplicar = true`;
   - `aplicador_herda_o_dono = true`;
   - `servidor_fora_do_dono = true`.

   **Guardar a linha.** **PARAR** se qualquer valor diferir.
2. Abrir `supabase/rollout/cosmeticos-aplicar.sql` **do SHA aprovado**, colar o arquivo **inteiro** e
   rodar **uma vez**. Só está aplicado se a última tela mostrar
   **`COSMÉTICOS (ENTREGA B) APLICADA E CONFERIDA`**, com `escolhas_gravadas = 0`.

   O arquivo é **uma transação**:
   - recusas iniciais;
   - retrato do "antes";
   - as **duas** migrações (parte 1: moldura, baralho e reação; parte 2: a toalha), cada uma idêntica
     ao arquivo oficial (o sha256 de cada uma está no cabeçalho);
   - **7 conferências**;
   - `commit`.

   Qualquer falha não grava **nada**. Nesse caso, rodar `rollback;` sozinho e mandar o erro.
3. Rodar `supabase/rollout/cosmeticos-checkpoint-3-depois.sql` (**só leitura**). Esperado:
   - `tudo_certo = true`;
   - números do progresso **iguais ou maiores** que os do checkpoint 1;
   - `credito_md5`, `nivel_md5` e `schema_public_acl` **iguais**.

### Passo 2 — servidor de jogo (VPS, Tito no Web Terminal)

- **O que sobe:** o commit aprovado, pelo deploy transacional de sempre (bloco `king_deploy` +
  `scripts/verificar-implantacao.mjs`).
- **Configuração:** **nenhuma variável nova**. Os cosméticos usam o mesmo pool e o mesmo papel
  `king_server` do progresso, e obedecem ao mesmo disjuntor.
- **Depois:** rodar o verificador público e conferir que uma partida online de 2 humanos continua
  creditando XP.

### Passo 3 — web (main → Vercel Production)

- **O que fazer:** fast-forward da `main` até o SHA aprovado.
- **Depois:** smoke público, com:
  - a vitrine;
  - a celebração;
  - a moldura na mesa;
  - a coroa entre dois aparelhos.

### Rollback, na ordem inversa

1. **Web:** promover o deploy anterior na Vercel.
2. **Servidor:** fazer o rollback automático do `king_deploy`, ou implantar o commit anterior.
3. **Banco**, nesta ordem:
   - `supabase/rollback/20261118120000_cosmeticos_mesa_rollback.sql` (tira só a toalha; as outras
     escolhas ficam);
   - `supabase/rollback/20261117120000_cosmeticos_rollback.sql` (tira o resto).

   Os dois apagam **só** escolhas de cosméticos; XP, ledger e contas ficam intactos. Depois deles, o
   checkpoint 1 volta a dar `pronto_para_aplicar = true`.

## Provas locais (Postgres 17 real, descartável)

`node scripts/testar-cosmeticos-sql.mjs --provas` → **24/24 testes + 22 mutações**:

| Testes | O que provam |
|---|---|
| K1–K14 | regra, isolamento e privilégios (parte 1) |
| K15–K19 | a toalha: bordas 1749/1750 e 2699/2700, catálogo fechado, mesa do anfitrião só para o servidor, não apaga as outras escolhas, rollback só da parte 2 |
| R1 | o arquivo de rollout traz as duas migrações verbatim, na ordem, com o sha256 de cada uma |
| R2 | o arquivo aplica pelo papel não superusuário do SQL Editor; os checkpoints 1 e 3 conferem, e o progresso fica idêntico |
| R3 | colado duas vezes, ele recusa na parte 1 e não altera nada |
| R4 | **13 defeitos** plausíveis nas migrações abortam nas conferências **sem gravar nada** |
| R5 | o rollback volta o banco **exatamente** ao de antes |

Os 9 defeitos do R4:
- `equipar` liberado para `anon`;
- sem RLS;
- política aberta;
- catálogo errado;
- cliente com UPDATE;
- porta da sala para `service_role`;
- mexer no XP;
- schema `public` não fechado;
- sem cascade;
- `equipar_toalha` liberado para `anon`;
- catálogo da toalha errado;
- a mesa do anfitrião para `service_role`;
- coluna da toalha sem o catálogo.

## Homologação isolada — iPhone ponta a ponta, sem banco real

`node scripts/homologacao-cosmeticos.mjs` sobe **neste PC**:
- **Postgres 17 com TLS** e CA própria, com todas as migrações. Os cosméticos entram pelo **mesmo
  arquivo** `cosmeticos-aplicar.sql`, conferido.
- **"Mini Supabase":** só `/auth/v1` e `/rest/v1`, sobre esse banco. RLS, GRANTs e
  `equipar_cosmetico` são os de verdade, com JWT ES256.
- **Servidor de jogo desta branch:** identidade `permanent` e progresso `database`, com TLS
  verificado. A sonda dá `closed`.
- **Web desta branch.**

Tudo isso numa **única porta HTTPS** (`https://<IP do Wi-Fi>:8443`). O painel
`https://<IP>:8443/homolog` dá **XP sintético** (100 / 450 / 1000 / 1750 / 2700 = níveis 2 / 4 / 6 / 8 / 10) a
cada conta, só nesse banco. O
Ctrl+C apaga tudo.

**No iPhone** (mesmo Wi-Fi que o PC):
1. Abrir `https://<IP>:8443`. O Safari avisa que o certificado não é confiável: tocar em
   "Mostrar detalhes" → "visitar este site".
2. Se mesmo assim o jogo não conectar, instalar a CA impressa no console como perfil e ativá-la em
   Ajustes → Geral → Sobre → Ajustes de Confiança de Certificados. É só para o teste; remover depois.
3. Jogar com amigos → Criar uma sala, para criar a conta anônima no banco local.
4. No painel `/homolog`, dar 2700 XP à conta (nível 10: todos os itens).
5. Voltar para a Home. A celebração "NOVO ITEM DESBLOQUEADO!" aparece; abrir "Ver itens",
   equipar moldura, baralho e coroa e tocar "Usar" na Esmeralda Real.
6. Criar uma sala e abrir o mesmo endereço noutro aparelho (ou no PC). Confirmar:
   - a sala nasce na Esmeralda Real, a mesma nos dois;
   - a moldura nos dois, e o realce dela na sua vez;
   - a coroa no balão;
   - o baralho só no iPhone.

**O Windows pode pedir para liberar o Node.js na rede privada.** Essa liberação é do Tito; eu não
mexo em firewall.

**Ensaio da rodada premium (18/11)**, no mesmo ambiente com as duas migrações: **14/15 PASS** em
`artifacts/web/cosmeticos/premium-v2/evidencias.txt` (checkout principal), com 10 capturas:
- celebração no nível 10;
- vitrine por categoria;
- a sala nascendo na toalha equipada do anfitrião;
- moldura premium no lobby e na mesa, com o realce na vez (no WebKit iPhone);
- cadeado das mesas de nível para o anfitrião nível 1;
- a mesma toalha nos dois aparelhos;
- o baralho só no aparelho de quem equipou;
- a coroa.

O único FAIL é o `Wrong protocol` do WebKit, preexistente.

**Ensaio automatizado** da rodada anterior (Playwright, fora do repositório; o resultado está em
`artifacts/web/cosmeticos/entrega-b/homologacao/homologacao.txt` no checkout principal): 14/15 PASS.
Os aparelhos:
- A: WebKit iPhone 13, web nova;
- B: Chromium Pixel 7, web nova;
- D: **web antiga do Android 0.1.1 (`c79e545`)**.

O que passou:
- conta criada por JWT;
- celebração no nível 6;
- equipar pelo banco sem mexer no XP;
- moldura no lobby e na mesa;
- baralho só local;
- coroa só no painel liberado;
- balão no B;
- **D não recebe a coroa**, recebe as frases e **joga**;
- reconexão mantém a moldura;
- XP intacto.

O único FAIL é `Wrong protocol for WebSocket '[object Object]'` no WebKit, **pré-existente**: o
mesmo erro aparece na main `b87f02c`, num teste lado a lado.

**Não verificado:** o iPhone físico. Esse teste é do Tito, com o roteiro acima.

## Checklist — Android 0.1.1 já distribuído (web `c79e545` dentro do AAB)

| # | Item | Situação |
|---|---|---|
| 1 | O protocolo não muda (`PROTOCOL_VERSION` = 3): o app antigo continua entrando | ✅ homologação (D sentou) e e2e |
| 2 | Campos novos do assento (`moldura`, `coroa`) são ignorados pelo leitor antigo | ✅ `lerEstadoDaSala` lê só o que conhece; homologação |
| 3 | O app antigo **não recebe** a Reação da Coroa: sem som e sem balão | ✅ servidor envia só a quem declara `recursos: ["coroa"]` (teste com 3 mutações) e homologação |
| 4 | Frases comuns continuam indo e vindo para o app antigo | ✅ teste do servidor e homologação |
| 5 | O app antigo joga a partida inteira | ✅ homologação (cartas saindo da mão, com 2 humanos novos) |
| 6 | Reconexão do app antigo | ✅ mesmo caminho de sempre (`recoveryToken`); o recurso é guardado por sessão e sobrevive à reconexão |
| 7 | Quem joga no app antigo não vê a moldura dos outros nem tem a vitrine | ⚠️ esperado: os itens são da web nova; o app só ganha com um AAB novo (fora do escopo) |
| 8 | O XP ganho no app antigo conta para os desbloqueios | ✅ mesmo `creditar_partida`, sem mudança |
| 9 | Nenhum AAB/APK novo e nenhuma mudança na Google Play | ✅ nada gerado nem enviado |
| 10 | Sala com a Vinho ou a Esmeralda: o app antigo não conhece essas mesas | ⚠️ esperado: ele desenha a Noite Imperial (o leitor cai no padrão); joga normalmente |
| 11 | Anfitrião no app antigo | ✅ só oferece as duas mesas livres, que o servidor sempre aceita |
