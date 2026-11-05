// O PESO DO GRAFO DE ÁUDIO DO KING — rodada 8 (04/11/2026).
//
// Evidência física (Android 13, Chromium 156 WebView, APK r7): o contexto do KING rendia 0,47 do tempo real
// com 1.040 underruns em 60 s; um contexto limpo, ao lado, 1,00 sem underrun. A escada (o grafo do KING
// montado peça por peça num contexto limpo) caiu no reverb: E2 compressor 0,9965 → E3 reverb estéreo de 2,4 s
// 0,753 → E4 carga da música 0,537 → E5 efeitos 0,502. Com o grafo isolado (I2), o MESMO contexto voltou a
// 1,0003 e o A′ foi ouvido. Leitura: o processamento do grafo não cabe no tempo real desse aparelho.
//
// Este módulo guarda os números do grafo (os mesmos de sempre) e os PERFIS de peso:
//   • "original" — o grafo de sempre: reverb por convolução estéreo de 2,4 s, um envio ao reverb POR NOTA.
//     Continua sendo o do iPhone e do computador (som validado lá; nada muda).
//   • "leve" — o do Android: (1) reverb MONO e CURTO (1,2 s), cortado do MESMO envelope de 2,4 s — o pedaço
//     que sai é ~1,4% da energia da cauda — com o volume do "molhado" COMPENSADO (o ConvolverNode normaliza
//     pela potência média do impulso: impulso mais curto sairia ~3 dB mais baixo); (2) envios ao reverb
//     COMPARTILHADOS: um nó de envio por quantidade (0,32 · 0,14 · 0,18 …), em vez de um nó novo por nota que
//     ficava vivo 3 s depois dela. A soma que chega ao reverb é a MESMA (ganho é linear) — saída idêntica,
//     com menos nós no processamento.
//   • "leve-24k" — o "leve" num contexto a 24 kHz: TODO o processamento cai pela metade (metade dos quanta por
//     segundo, em todos os nós). É o PADRÃO DO ANDROID: na bancada do PC (Chromium, renderização offline, 60 s de
//     música + efeitos) o "leve" custa 62% do original e o "leve-24k" 31%; projetado no aparelho da r7 (KING a
//     0,47 do tempo real ≈ 2,1 s de processamento por segundo de áudio), só o "leve-24k" fica abaixo de 1 com
//     folga (≈ 0,66) — o "leve" sozinho ficaria em ≈ 1,3 (ainda abaixo do tempo real). Projeção, não prova: o
//     teste físico decide. O que se perde: o que mora acima de 12 kHz — no som do KING, −55 dB da energia
//     (inaudível; nenhum efeito passa de 6 kHz). Notas, algoritmo musical e volumes: os mesmos.
//   • "sem-reverb", "leve-polifonia" — SÓ para a comparação no APK DEBUG (variantes B e D).

/** Os números do grafo do KING (os mesmos de sempre). O motor monta com eles; o laboratório também. */
export const PARAMETROS_DO_GRAFO = {
  master: 0.9,
  compressor: { threshold: -15, knee: 26, ratio: 3.2, attack: 0.004, release: 0.22 },
  reverb: { segundos: 2.4, decaimento: 2.6, wet: 0.9, corte: 3200 },
  analisadorFft: 256,
  ruidoSegundos: 1.2,
} as const;

/** O reverb leve: o começo (1,2 s) do MESMO envelope de 2,4 s, mono, com um fim suave de 60 ms. */
export const REVERB_LEVE = { segundos: 1.2, canais: 1, fimSuave: 0.06 } as const;

export type ModoDoReverb = "estereo" | "mono-curto" | "nenhum";
export type NomeDoPerfil = "original" | "sem-reverb" | "leve" | "leve-polifonia" | "leve-24k";

export interface PerfilDoGrafo {
  nome: NomeDoPerfil;
  reverb: ModoDoReverb;
  /** Um nó de envio ao reverb por QUANTIDADE (compartilhado), em vez de um por nota. */
  enviosCompartilhados: boolean;
  /** Variante D (só DEBUG): violão sem a tônica (o baixo já a toca) e ganzá só nos tempos. */
  polifoniaReduzida: boolean;
  /** Taxa do contexto. `null` = `new AudioContext()` sem opção nenhuma (o original). */
  taxa: number | null;
}

/** Os dois perfis de PRODUÇÃO (os únicos que o build normal leva). */
export const PERFIL_ORIGINAL: PerfilDoGrafo = { nome: "original", reverb: "estereo", enviosCompartilhados: false, polifoniaReduzida: false, taxa: null };
export const PERFIL_ANDROID: PerfilDoGrafo = { nome: "leve-24k", reverb: "mono-curto", enviosCompartilhados: true, polifoniaReduzida: false, taxa: 24000 };

/** Todos, para as variantes do APK DEBUG (só a sonda usa — o build normal não carrega as variantes B, C e D). */
export const PERFIS: Readonly<Record<NomeDoPerfil, PerfilDoGrafo>> = {
  original: PERFIL_ORIGINAL,
  "sem-reverb": { nome: "sem-reverb", reverb: "nenhum", enviosCompartilhados: false, polifoniaReduzida: false, taxa: null },
  leve: { nome: "leve", reverb: "mono-curto", enviosCompartilhados: true, polifoniaReduzida: false, taxa: null },
  "leve-polifonia": { nome: "leve-polifonia", reverb: "mono-curto", enviosCompartilhados: true, polifoniaReduzida: true, taxa: null },
  "leve-24k": PERFIL_ANDROID,
};

/**
 * O perfil de PRODUÇÃO: "leve-24k" só no Android (onde o grafo original não coube no tempo real); "original"
 * no iPhone e no computador, onde o som foi validado e nada precisa mudar.
 */
export function perfilPadrao(android: boolean): PerfilDoGrafo {
  return android ? PERFIL_ANDROID : PERFIL_ORIGINAL;
}

/** O envelope do impulso do KING (pré-atraso curto + decaimento), em `t` = fração dos 2,4 s. */
function envelope(t: number, decay: number): number {
  // pré-atraso curto deixa o ataque do som limpo antes da cauda entrar
  const pre = t < 0.012 ? t / 0.012 : 1;
  return Math.pow(1 - t, decay) * pre;
}

/** Fim suave (meio cosseno) nos últimos `fimSuave` segundos do impulso cortado. */
function fimSuave(i: number, len: number, fimLen: number): number {
  const resta = len - 1 - i;
  if (fimLen <= 0 || resta >= fimLen) return 1;
  return 0.5 - 0.5 * Math.cos((Math.PI * resta) / fimLen);
}

/**
 * Ruído com decaimento = sala plausível, sem assets (a resposta do reverb). Sem `opcoes`, é o impulso de
 * sempre (estéreo, `seconds` inteiros). Com `opcoes`, gera só o COMEÇO (`opcoes.segundos`) do mesmo
 * envelope de `seconds`, com `opcoes.canais` canais e um fim suave.
 */
export function gerarImpulso(
  ctx: BaseAudioContext, seconds: number, decay: number,
  opcoes?: { segundos: number; canais: number; fimSuave: number },
): AudioBuffer {
  const lenTotal = Math.floor(ctx.sampleRate * seconds);
  const len = opcoes ? Math.min(lenTotal, Math.floor(ctx.sampleRate * opcoes.segundos)) : lenTotal;
  const canais = opcoes?.canais ?? 2;
  const fimLen = opcoes ? Math.floor(ctx.sampleRate * opcoes.fimSuave) : 0;
  const buf = ctx.createBuffer(canais, len, ctx.sampleRate);
  for (let ch = 0; ch < canais; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * envelope(i / lenTotal, decay) * fimSuave(i, len, fimLen);
    }
  }
  return buf;
}

/**
 * Quanto multiplicar o "molhado" do reverb leve para ele sair no MESMO volume do original. O ConvolverNode
 * (normalize = true, o padrão) divide o impulso pela raiz da potência MÉDIA (por amostra e por canal):
 * cortar a cauda quieta sobe essa média e abaixa o reverb. A razão das duas médias (esperança do ruído
 * cancela) devolve o volume. Calculado no envelope — determinístico, sem depender do sorteio do ruído.
 */
const compensacoes = new Map<number, number>();
export function compensacaoDoReverbLeve(taxa = 48000): number {
  const pronta = compensacoes.get(taxa);
  if (pronta !== undefined) return pronta;
  const k = calcularCompensacao(taxa);
  compensacoes.set(taxa, k);
  return k;
}
function calcularCompensacao(taxa: number): number {
  const P = PARAMETROS_DO_GRAFO.reverb;
  const lenTotal = Math.floor(taxa * P.segundos);
  const len = Math.min(lenTotal, Math.floor(taxa * REVERB_LEVE.segundos));
  const fimLen = Math.floor(taxa * REVERB_LEVE.fimSuave);
  let somaTotal = 0;
  let somaCorte = 0;
  for (let i = 0; i < lenTotal; i++) {
    const e = envelope(i / lenTotal, P.decaimento);
    somaTotal += e * e;
    if (i < len) { const c = e * fimSuave(i, len, fimLen); somaCorte += c * c; }
  }
  return Math.sqrt((somaCorte / len) / (somaTotal / lenTotal));
}

/** Notas do compasso por perfil: o que a variante D (polifonia reduzida) deixa de tocar. */
export function tocaNotaDoViolao(p: PerfilDoGrafo, indiceDaNota: number): boolean {
  return !p.polifoniaReduzida || indiceDaNota !== 0;
}
export function tocaGanza(p: PerfilDoGrafo, semicolcheia: number): boolean {
  return !p.polifoniaReduzida || semicolcheia % 4 === 0;
}
