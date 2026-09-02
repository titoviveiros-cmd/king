// POLÍTICA DA FILA DE APRESENTAÇÃO — a regra dos "dois relógios", isolada e testável.
//
// No modo local a apresentação manda no jogo: os bots esperam a mesa liberar. Online isso se
// inverte — o servidor já resolveu tudo e as atualizações chegam sem esperar animação nenhuma.
//
// A regra é: **a apresentação pode atrasar, nunca adiantar, e nunca bloqueia o envio.**
//
// Fica fora do hook de propósito. É aqui que mora o comportamento que quebra na mão de gente
// real — voltar de segundo plano no iPhone com vinte atualizações represadas —, e isso precisa
// ser verificável sem montar componente.
import type { Causa } from "../net/protocolo.js";

/**
 * Causas que NÃO entram na fila: são salto imediato para o presente.
 *
 * Encenar o que já passou depois de uma reconexão é a maneira mais rápida de mostrar ao jogador
 * um estado que não existe mais. Nestes três casos a resposta certa é sempre "vá direto ao que é".
 */
const SALTOS: ReadonlySet<Causa> = new Set<Causa>(["RESYNC", "RECONNECTED", "MATCH_STARTED"]);

export function ehSalto(causa: Causa): boolean {
  return SALTOS.has(causa);
}

/**
 * QUANTAS ATUALIZAÇÕES PODEM FICAR REPRESADAS ANTES DE A FILA COLAPSAR.
 *
 * ══ DE ONDE VEM O NÚMERO ══
 *
 * Era 2, e 2 é MENOS do que o jogo normal produz. A mesa para para ler uma vaza com bucha
 * (2700ms) ou o Rei de Copas (3400ms) — pausas aprovadas, que não se mexem —, e durante elas o
 * servidor segue jogando: um bot a cada 900ms. Três jogadas represadas passavam do teto, a fila
 * COLAPSAVA, e duas cartas simplesmente nunca eram apresentadas: as três apareciam de uma vez.
 * O colapso existe para a avalanche de quem volta do segundo plano, e estava disparando no meio
 * de uma partida comum.
 *
 * O piso é quantas jogadas cabem na maior pausa aprovada:
 *
 *     ceil(leituraDaVazaKing / cortesiaDoBot) = ceil(3400 / 900) = 4
 *
 * O valor é 5, um acima do piso — porque "cabe exatamente" é sorte, não margem: bastaria a pausa
 * crescer um pouco, ou um tique cair do lado errado da borda, para voltar a descartar carta. O
 * teste de cadência recalcula esse piso a partir dos dois arquivos e reprova se a folga sumir.
 *
 * O outro lado continua protegido: uma aba que passou minutos em segundo plano volta com dezenas
 * de atualizações, muito acima de 5, e continua colapsando como sempre.
 */
export const LIMITE_DA_FILA = 5;

export interface PassoDaFila<T> {
  /** O que aplicar agora, ou `null` se não há nada a fazer. */
  proxima: T | null;
  /** A fila estava atrasada demais e pulou direto para o presente. */
  colapsou: boolean;
  /** A fila que resta depois deste passo. */
  resto: T[];
}

/**
 * Consome UM passo da fila.
 *
 * Até `limite` atualizações represadas, cada uma é encenada no ritmo aprovado. Acima disso a fila
 * COLAPSA: aplica só a mais recente e descarta o resto. Sem esse teto, uma aba que ficou em
 * segundo plano volta e dispara uma avalanche de animações atrasadas — o jogo pareceria travado
 * enquanto "recupera" um passado que ninguém precisa ver.
 */
export function proximoPasso<T>(fila: readonly T[], limite: number): PassoDaFila<T> {
  if (fila.length === 0) return { proxima: null, colapsou: false, resto: [] };
  if (fila.length > limite) {
    return { proxima: fila[fila.length - 1], colapsou: true, resto: [] };
  }
  return { proxima: fila[0], colapsou: false, resto: fila.slice(1) };
}

/**
 * AS CAUSAS QUE OCUPAM UM PASSO DA CADÊNCIA.
 *
 * São as que o jogador VÊ acontecer na mesa: uma carta pousando, o trunfo sendo revelado, a mão
 * virando. Cada uma precisa do seu próprio instante — é isso que `botPasso` significa, e o nome
 * do token do cliente já dizia: "intervalo entre passos dos bots (jogar carta, escolher trunfo)".
 *
 * Hoje o conjunto cobre TODAS as causas que chegam a entrar na fila (`RESYNC`, `RECONNECTED` e
 * `MATCH_STARTED` são saltos e nunca entram). A regra fica escrita como REGRA, e não como um `1`
 * fixo, porque no dia em que existir uma causa que não muda nada na mesa ela deve poder
 * acompanhar o passo seguinte sem gastar um tique só para si.
 */
const CADENCIADAS: ReadonlySet<Causa> = new Set<Causa>(
  ["CARD_PLAYED", "TRUMP_SELECTED", "HAND_ADVANCED"],
);

export function ehCadenciada(causa: Causa): boolean {
  return CADENCIADAS.has(causa);
}

/**
 * QUANTAS ATUALIZAÇÕES CONSUMIR NESTE TIQUE — no máximo UMA que se veja acontecer.
 *
 * ══ O DEFEITO QUE ESTA FUNÇÃO CORRIGE ══
 *
 * Antes: `fila.length > 1 ? 2 : 1`. Dois passos no mesmo tique são duas cartas no mesmo quadro.
 * Numa partida física real, dois bots em assentos consecutivos jogavam praticamente juntos e não
 * havia como ler a vaza. Aquela política entrou para fechar um atraso de ~1s entre dois
 * aparelhos, e trocou um atraso que ninguém sente num jogo de turnos por um defeito de leitura
 * que todo mundo sente.
 *
 * ══ POR QUE RECUPERAR NÃO EXIGE LOTE ══
 *
 * O cliente apresenta a cada `botPasso` (520ms) e o servidor produz jogada de bot a cada
 * `cortesiaDoBot` (900ms). Apresentar é mais rápido que produzir, então qualquer represamento
 * encurta 380ms a cada passo e se fecha sozinho. O lote nunca foi necessário — era pressa.
 */
export function quantosPorTique<T>(fila: readonly T[], cadenciada: (item: T) => boolean): number {
  let n = 0;
  for (const item of fila) {
    n++;
    if (cadenciada(item)) break;
  }
  return Math.max(1, n);
}
