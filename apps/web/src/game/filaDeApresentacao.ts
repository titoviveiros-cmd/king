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
