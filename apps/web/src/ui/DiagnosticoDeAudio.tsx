// PAINEL "DIAGNÓSTICO DE ÁUDIO" — SÓ no APK DEBUG de QA (rodada 5, 04/11/2026: sem cabo USB, sem ADB).
//
// Mora dentro do painel de som e só é desenhado quando `DIAG_LIGADO` (constante de build): no build
// normal o `AudioPanel` nem o importa de verdade, e este arquivo some do pacote. Estilos INLINE de
// propósito: nada de regra de CSS de diagnóstico sobrando no build de publicação.
//
// A ordem importa: "Registrar falha de som" GUARDA o estado defeituoso e não repara nada. Os retratos
// tirados no `pointerdown` (antes do touchend/click em que o motor troca o contexto) fazem o mesmo
// pelo toque no 🔊 que abriu o painel. Testes (B) e recuperação (C) vêm depois, em botões próprios.

import { useEffect, useReducer, useState, type CSSProperties } from "react";
import { audio } from "../audio/engine.js";
import { diagAudio } from "../audio/diagnostico.js";
import {
  ambienteDoAparelho, compartilharTexto, copiarTexto, criarSessaoDeDiagnostico, podeCompartilhar,
  type AmbienteDoRelatorio, type ExecutoresDiferenciais, type SessaoDeDiagnostico, type TesteDiferencial, type TesteRegistrado,
} from "../audio/relatorioDeAudio.js";
import {
  lerSistema, testarHtml5, testarNativo, testarTomDiretoNoMotor, testarWebAudioIsolado,
  type JanelaDeAudio, type LetraDiferencial, type PluginDeAudioNativo, type ResultadoDiferencial,
} from "../audio/testesDiferenciais.js";
import { VERSAO_DO_APP } from "../versao.js";
import { criarContextoLimpo, criarEscada, medicaoEmCampos, medirRelogio, type Escada } from "../audio/laboratorio.js";
import type { Valor } from "../audio/diagnostico.js";
import type { NomeDoPerfil } from "../audio/perfilDoGrafo.js";

/**
 * O plugin NATIVO do APK debug (rodada 6: AudioTrack + AudioManager, só leitura). Fora do Android, ou
 * num APK sem o plugin (release), `null`. Embrulhado num objeto COMUM: o plugin do Capacitor é um Proxy
 * que responde até a `then` — devolvido cru por uma função async, vira "promessa" que nunca resolve
 * (o defeito do vc1, ver nativo/arranque.ts).
 */
let pluginPromessa: Promise<PluginDeAudioNativo | null> | null = null;
function pluginNativo(): Promise<PluginDeAudioNativo | null> {
  return (pluginPromessa ??= (async () => {
    try {
      const { Capacitor, registerPlugin } = await import("@capacitor/core");
      if (Capacitor.getPlatform() !== "android" || !Capacitor.isPluginAvailable("DiagAudioNativo")) return null;
      const p = registerPlugin<PluginDeAudioNativo>("DiagAudioNativo");
      const embrulho: PluginDeAudioNativo = { estado: () => p.estado(), tocarTom: (o) => p.tocarTom(o) };
      return embrulho;
    } catch {
      return null;
    }
  })());
}

const esperar = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));
const prefixar = (p: string, o: Record<string, Valor>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [`${p}.${k}`, v]));
const janela = () => (typeof window !== "undefined" ? (window as unknown as JanelaDeAudio) : undefined);

/** RODADA 7: a escada (grafo do KING peça por peça, num contexto limpo) — uma por app. */
let escada: Escada | null = null;
export function escadaDoApp(): Escada { return (escada ??= criarEscada(janela())); }

/** R: o relógio do KING e o de um contexto limpo (caminho do A), lado a lado, pelo mesmo tempo. */
async function medirRelogiosLadoALado(ms: number): Promise<ResultadoDiferencial> {
  const base = { letra: "R" as const, mecanismo: `relógios lado a lado por ${ms / 1000} s: contexto do KING × contexto limpo (caminho do A, sinal inaudível)`, semOuvir: true };
  const limpo = criarContextoLimpo(janela()); // síncrono: dentro do toque
  const sonda = audio.sondaDeDiagnostico();
  const antes = sonda?.retrato();
  const [rei, lp] = await Promise.all([
    medirRelogio("KING", sonda?.contextoParaMedir() ?? null, ms),
    medirRelogio("limpo", limpo?.ctx ?? null, ms),
  ]);
  await limpo?.fechar();
  const depois = sonda?.retrato();
  return {
    ...base, aceitou: true, erro: null,
    tecnico: { ...prefixar("rei", medicaoEmCampos(rei)), ...prefixar("limpo", medicaoEmCampos(lp)), vozesAntes: antes?.vozes ?? null, vozesDepois: depois?.vozes ?? null, musica: depois?.musicaAgendada ?? null },
  };
}

/** I1/I2: no contexto do KING — para a música (I1) ou isola o grafo (I2), mede 10 s e toca A′ no fim. */
async function isolamento(letra: "I1" | "I2"): Promise<ResultadoDiferencial> {
  const sonda = audio.sondaDeDiagnostico();
  const mecanismo = letra === "I1" ? "contexto do KING com a música PARADA: medição de 10 s e A′ no fim" : "contexto do KING com o grafo ISOLADO (master fora da saída e do analisador): medição de 10 s e A′ no fim";
  if (!sonda) return { letra, mecanismo, aceitou: false, tecnico: {}, erro: "indisponível (sem motor)" };
  const feito = letra === "I1" ? sonda.pararMusica() : (sonda.pararMusica(), sonda.isolarGrafo());
  await esperar(3000); // as notas já agendadas terminam
  const m = await medirRelogio(letra, sonda.contextoParaMedir(), 10_000);
  const a = await testarTomDiretoNoMotor(sonda);
  return { letra, mecanismo, aceitou: a.aceitou, erro: a.erro, tecnico: { [letra === "I1" ? "musicaEstava" : "isolou"]: feito, ...medicaoEmCampos(m), vozes: sonda.retrato().vozes ?? null } };
}

/** RODADA 8: as variantes do grafo — o PRÓPRIO motor, num contexto novo montado com o perfil (um de cada vez). */
export const VARIANTES_DO_PAINEL: Record<"VA" | "VB" | "VC" | "VD" | "VE", { perfil: NomeDoPerfil; nome: string }> = {
  VA: { perfil: "original", nome: "A · original (reverb estéreo 2,4 s, um envio por nota)" },
  VB: { perfil: "sem-reverb", nome: "B · sem convolução (sem reverb e sem envios)" },
  VC: { perfil: "leve", nome: "C · leve (reverb mono 1,2 s compensado, envios compartilhados; 48 kHz)" },
  VD: { perfil: "leve-polifonia", nome: "D · leve + polifonia reduzida (violão sem tônica, ganzá nos tempos)" },
  VE: { perfil: "leve-24k", nome: "E · leve a 24 kHz = a CORREÇÃO do Android (o padrão deste APK)" },
};
/** Quanto cada variante mede (depois de 3 s para o contexto novo assentar). */
export const VARIANTE_MS = 20_000;

async function variante(letra: keyof typeof VARIANTES_DO_PAINEL): Promise<ResultadoDiferencial> {
  const v = VARIANTES_DO_PAINEL[letra];
  const mecanismo = `variante ${v.nome}: contexto novo do motor, música + 1 efeito a cada 0,4 s, relógio medido por ${VARIANTE_MS / 1000} s`;
  const sonda = audio.sondaDeDiagnostico();
  if (!sonda) return { letra, mecanismo, aceitou: false, tecnico: {}, erro: "indisponível (sem motor)" };
  const trocou = sonda.usarPerfil(v.perfil); // síncrono: dentro do toque (o contexto novo precisa dele)
  if (!trocou) return { letra, mecanismo, aceitou: false, tecnico: { perfil: sonda.perfil().nome }, erro: "não trocou (sem contexto, em fundo ou troca em curso)" };
  await esperar(3000);
  let vozesMax = 0;
  const fx = setInterval(() => {
    audio.tone({ freq: 880, dur: 0.16, gain: 0.08 }); // o mesmo `tone` dos efeitos do jogo
    const vz = sonda.retrato().vozes;
    if (typeof vz === "number") vozesMax = Math.max(vozesMax, vz);
  }, 400);
  const ctx = sonda.contextoParaMedir();
  const m = await medirRelogio(letra, ctx, VARIANTE_MS);
  clearInterval(fx);
  return {
    letra, mecanismo, aceitou: true, erro: null,
    tecnico: { perfil: sonda.perfil().nome, taxa: ctx?.sampleRate ?? null, ...medicaoEmCampos(m), vozesMax },
  };
}

/** Os testes diferenciais de verdade. A, A′ e B começam SÍNCRONOS, dentro do toque. */
export function executoresDoApp(): ExecutoresDiferenciais {
  return {
    executar(letra: LetraDiferencial) {
      if (letra === "R") return medirRelogiosLadoALado(60_000);
      if (letra in VARIANTES_DO_PAINEL) return variante(letra as keyof typeof VARIANTES_DO_PAINEL);
      if (letra === "I1" || letra === "I2") return isolamento(letra);
      if (letra.startsWith("E")) {
        return escadaDoApp().proximo(8000).then((r): ResultadoDiferencial => (r
          ? { letra: r.degrau, mecanismo: `escada ${r.degrau}: ${r.nome} (contexto limpo, marcador audível a cada 0,5 s)`, aceitou: true, erro: null, tecnico: { ...medicaoEmCampos(r.medicao), vozes: r.vozes } }
          : { letra, mecanismo: "escada", aceitou: false, erro: "indisponível (escada já no fim — Encerrar escada)", tecnico: {} }));
      }
      if (letra === "A") return testarWebAudioIsolado(typeof window !== "undefined" ? (window as unknown as JanelaDeAudio) : undefined);
      if (letra === "A′") return testarTomDiretoNoMotor(audio.sondaDeDiagnostico());
      if (letra === "B") {
        return testarHtml5(typeof Audio === "function" && typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
          ? { criarAudio: (src) => new Audio(src), criarUrl: (b) => URL.createObjectURL(b), soltarUrl: (u) => URL.revokeObjectURL(u) }
          : null);
      }
      return pluginNativo().then((p) => testarNativo(p));
    },
    sistema: () => pluginNativo().then((p) => lerSistema(p)),
  };
}

let unica: SessaoDeDiagnostico | null = null;
/** A sessão do app: vive enquanto o app vive (fechar o painel não perde o que foi registrado). */
export function sessaoDoApp(): SessaoDeDiagnostico {
  return (unica ??= criarSessaoDeDiagnostico({
    diag: diagAudio, sonda: () => audio.sondaDeDiagnostico(), diferenciais: executoresDoApp(),
    monitor: () => audio.sondaDeDiagnostico()?.monitor()?.resumo(24) ?? null,
  }));
}

/** O 🔊 chama isto ANTES do reparo dele (`audio.reativar`). */
export function aoAbrirPainelDeSom(): void {
  sessaoDoApp().aoAbrirPainelDeSom();
}

function ambienteAtual(): AmbienteDoRelatorio {
  const w = typeof window !== "undefined" ? (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }) : undefined;
  return ambienteDoAparelho({
    nav: typeof navigator !== "undefined" ? navigator : undefined,
    tela: w?.screen ? { width: w.screen.width, height: w.screen.height } : null,
    dpr: w?.devicePixelRatio ?? null,
    nativo: w?.Capacitor?.isNativePlatform?.() ?? null,
    versao: VERSAO_DO_APP ?? null,
    build: typeof __KING_DIAG_BUILD__ === "string" ? __KING_DIAG_BUILD__ : null,
  });
}

const S: Record<string, CSSProperties> = {
  abrir: { marginTop: 10, width: "100%", fontSize: "0.85em" },
  ov: { zIndex: 60 },
  card: { maxHeight: "92vh", overflowY: "auto", textAlign: "left", maxWidth: "min(96vw, 560px)" },
  linha: { display: "flex", flexWrap: "wrap", gap: 8, margin: "8px 0" },
  bt: { flex: "1 1 46%", minHeight: 44, fontSize: "0.82em", padding: "0.4em 0.6em" },
  falha: { flex: "1 1 100%", minHeight: 48, fontWeight: 800 },
  aviso: { fontSize: "0.78em", lineHeight: 1.35, opacity: 0.85, margin: "4px 0" },
  msg: { fontSize: "0.82em", lineHeight: 1.35, margin: "6px 0", minHeight: "1.3em" },
  // rodada 8: a mensagem e o "Ouvi / Não ouvi" ficam FIXOS no topo do painel — no celular deitado o painel
  // rola, e embaixo das fileiras de botões a pergunta ficava fora da tela (as respostas da r7 não chegaram)
  topo: { position: "sticky", top: 0, zIndex: 1, background: "var(--surface, #241546)", paddingBottom: 4 },
  texto: {
    width: "100%", minHeight: 160, fontFamily: "monospace", fontSize: 11, lineHeight: 1.3,
    userSelect: "text", WebkitUserSelect: "text", whiteSpace: "pre", overflow: "auto",
  },
};

/** RODADA 8: o perfil em uso e a última janela do monitor contínuo (atualiza a cada 2 s com o painel aberto). */
function LinhaDoMonitor() {
  const [, tic] = useReducer((n: number) => n + 1, 0);
  useEffect(() => { const h = setInterval(tic, 2000); return () => clearInterval(h); }, []);
  const s = audio.sondaDeDiagnostico();
  const perfil = s?.perfil();
  const r = s?.monitor()?.resumo(1);
  const u = r?.recentes[r.recentes.length - 1];
  return (
    <div style={S.aviso} data-testid="diag-monitor">
      Perfil do grafo: <b>{perfil ? `${perfil.nome}${perfil.forcado ? " (forçado)" : " (automático)"}` : "—"}</b>
      {" · "}monitor: {u ? `última janela razão ${u.razao ?? "—"} · underruns ${u.underrunEventos ?? "não exposto"}` : "sem janela ainda"}
    </div>
  );
}

/** O botão "Diagnóstico de áudio" (dentro do painel de som) e o painel que ele abre. */
export function BotaoDiagnosticoDeAudio() {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button className="btn ghost" style={S.abrir} onClick={() => setAberto(true)}>Diagnóstico de áudio</button>
      {aberto && <PainelDiagnosticoDeAudio onClose={() => setAberto(false)} />}
    </>
  );
}

export function PainelDiagnosticoDeAudio({
  onClose,
  sessao = sessaoDoApp(),
  ambiente = ambienteAtual,
  nav = typeof navigator !== "undefined" ? navigator : undefined,
  doc = typeof document !== "undefined" ? (document as unknown as Parameters<typeof copiarTexto>[2]) : undefined,
}: {
  onClose: () => void;
  sessao?: SessaoDeDiagnostico;
  ambiente?: () => AmbienteDoRelatorio;
  nav?: Parameters<typeof copiarTexto>[1];
  doc?: Parameters<typeof copiarTexto>[2];
}) {
  const [, redesenhar] = useReducer((n: number) => n + 1, 0);
  const [msg, setMsg] = useState("");
  const [texto, setTexto] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const ocorrencias = sessao.ocorrencias();
  const ultima = ocorrencias[ocorrencias.length - 1];
  // o teste à espera do "ouviu?": o mais recente (motor ou diferencial)
  const pendente: TesteRegistrado | TesteDiferencial | undefined = [...(ultima?.testes ?? []), ...(ultima?.diferenciais ?? [])]
    .filter((t) => t.ouviu === null && !("indisponivel" in t && t.indisponivel) && !("letra" in t.resultado && t.resultado.semOuvir)).sort((a, b) => a.n - b.n).pop();

  // o áudio do Android, lido ao abrir (só leitura): o relatório usa a última leitura
  useEffect(() => { void sessao.lerSistema(); }, [sessao]);

  const registrar = () => {
    const o = sessao.registrarFalha();
    setMsg(`Falha #${o.n} registrada — o estado foi salvo ANTES de qualquer reparo. Agora: Testar música, Testar efeito.`);
    redesenhar();
  };
  const testar = (qual: "musica" | "efeito") => {
    setOcupado(true);
    setMsg(qual === "musica" ? "Tocando 3 notas pelo canal da música…" : "Tocando 2 notas pelo canal dos efeitos…");
    void sessao.testar(qual).then((t) => {
      setOcupado(false);
      setMsg(t.resultado.tocou ? "Você OUVIU o som de teste?" : `Não deu para tocar (${t.resultado.motivo ?? "?"}).`);
      redesenhar();
    });
  };
  const NOMES: Record<LetraDiferencial, string> = {
    A: "Tocando um tom num Web Audio À PARTE (sem o motor do jogo)…",
    "A′": "Tocando um tom direto na saída do motor do jogo (sem os canais)…",
    B: "Tocando um tom por <audio> HTML5 (fora do Web Audio)…",
    C: "Tocando um tom pelo Android NATIVO (fora da WebView)…",
    R: "Medindo os relógios por 60 s (KING × contexto limpo). Não toque em nada…",
    I1: "Parando a música do KING, medindo 10 s e tocando A′ no fim…",
    I2: "Isolando o grafo do KING, medindo 10 s e tocando A′ no fim (depois: Restaurar motor)…",
    E1: "Escada E1: só ganho — ouça o bip a cada 0,5 s (8 s)…",
    E2: "Escada E2: + compressor/master — ouça o bip (8 s)…",
    E3: "Escada E3: + reverb do KING — ouça o bip (8 s)…",
    E4: "Escada E4: + carga da música — ouça o bip no meio da música (8 s)…",
    E5: "Escada E5: + efeitos — ouça o bip (8 s)…",
    VA: `Variante ${VARIANTES_DO_PAINEL.VA.nome} — ouça a música e os bips (~${(VARIANTE_MS + 3000) / 1000} s)…`,
    VB: `Variante ${VARIANTES_DO_PAINEL.VB.nome} — ouça a música e os bips (~${(VARIANTE_MS + 3000) / 1000} s)…`,
    VC: `Variante ${VARIANTES_DO_PAINEL.VC.nome} — ouça a música e os bips (~${(VARIANTE_MS + 3000) / 1000} s)…`,
    VD: `Variante ${VARIANTES_DO_PAINEL.VD.nome} — ouça a música e os bips (~${(VARIANTE_MS + 3000) / 1000} s)…`,
    VE: `Variante ${VARIANTES_DO_PAINEL.VE.nome} — ouça a música e os bips (~${(VARIANTE_MS + 3000) / 1000} s)…`,
  };
  const diferencial = (letra: LetraDiferencial) => {
    setOcupado(true);
    setMsg(NOMES[letra]);
    void sessao.testarDiferencial(letra).then((t) => {
      setOcupado(false);
      setMsg(t.resultado.semOuvir
        ? `${letra}: medição pronta (está no relatório).`
        : t.indisponivel
        ? `${letra}: ${t.resultado.erro} — fica fora da matriz.`
        : t.resultado.erro && !t.resultado.aceitou
        ? `${letra}: não deu para tocar (${t.resultado.erro}). Toque em "Não ouvi" para anotar.`
        : letra in VARIANTES_DO_PAINEL
        ? `${letra}: a música e os bips tocaram NORMAIS (sem cortes, sem sumir)?`
        : `${letra}: você OUVIU o tom?`);
      redesenhar();
    });
  };
  const proximoDegrau = (): LetraDiferencial => {
    const atual = escadaDoApp().degrau();
    return (["E1", "E2", "E3", "E4", "E5"] as const)[atual ? Math.min(4, Number(atual.slice(1))) : 0];
  };
  const restaurarMotor = () => {
    const r = audio.sondaDeDiagnostico()?.restaurar();
    setMsg(r ? `Motor restaurado: ligações ${r.religou ? "religadas" : "já estavam/contexto trocado"} · música ${r.musica ? "tocando" : "parada"}.` : "Sem motor.");
    redesenhar();
  };
  const perfilAutomatico = () => {
    const s = audio.sondaDeDiagnostico();
    const trocou = s?.usarPerfil(null) ?? false;
    setMsg(s ? `Perfil automático (${s.perfil().nome})${trocou ? " — contexto novo." : " — vale no próximo contexto."}` : "Sem motor.");
    redesenhar();
  };
  const encerrarEscada = () => {
    void escadaDoApp().encerrar().then(() => { setMsg("Escada encerrada (o contexto limpo foi fechado)."); redesenhar(); });
  };
  const lerSistemaAgora = () => {
    void sessao.lerSistema().then((s) => {
      const c = s?.campos;
      setMsg(!c ? "Áudio do sistema: indisponível aqui (só no APK debug no Android)."
        : c.erro ? `Áudio do sistema: ${String(c.erro)}`
          : `Android: volume de mídia ${String(c.volumeMidia)}/${String(c.volumeMidiaMax)} · mudo ${String(c.midiaMuda)} · saída ${String(c.rotaAtual ?? c.saidas)} · tocando agora ${String(c.musicaAtiva)}`);
    });
  };
  const rotuloPendente = pendente ? `#${pendente.n} ${"letra" in pendente.resultado ? pendente.resultado.letra : pendente.resultado.qual}` : "";
  const responder = (ouviu: boolean) => {
    if (!pendente) return;
    sessao.responder(pendente, ouviu);
    setMsg(ouviu ? "Anotado: ouviu." : "Anotado: NÃO ouviu. Se quiser, toque em Tentar recuperar e teste de novo.");
    redesenhar();
  };
  const recuperar = () => {
    setOcupado(true);
    setMsg("Trocando o motor de som por um novo (o mesmo reparo do jogo)…");
    void sessao.recuperar().then(() => {
      setOcupado(false);
      setMsg("Pronto. Teste de novo a música e o efeito e diga se ouviu.");
      redesenhar();
    });
  };
  const gerar = () => {
    const t = sessao.relatorio(ambiente());
    setTexto(t);
    return t;
  };
  const copiar = () => {
    const t = gerar();
    void copiarTexto(t, nav, doc).then((r) => {
      setMsg(r === "falhou"
        ? "Não deu para copiar automaticamente. O texto está abaixo: toque nele, segure, \"Selecionar tudo\" e \"Copiar\"."
        : "Diagnóstico copiado. Cole numa conversa (WhatsApp/e-mail) e envie.");
    });
  };
  const compartilhar = () => {
    const t = gerar();
    void compartilharTexto(t, nav).then((r) => {
      setMsg(r === "compartilhado" ? "Compartilhado."
        : r === "cancelado" ? "Compartilhamento cancelado."
          : "Não deu para compartilhar. Use Copiar ou o texto abaixo.");
    });
  };

  return (
    <div className="ov" style={S.ov} onClick={onClose}>
      <div className="ovcard" style={S.card} onClick={(e) => e.stopPropagation()}>
        <h2>Diagnóstico de áudio</h2>
        <div style={S.topo} data-testid="diag-topo">
          <div style={S.msg} role="status">{msg}</div>
          {pendente && !ocupado && (
            <div style={S.linha}>
              <span style={S.aviso}>Responder {rotuloPendente}:</span>
              <button className="btn" style={S.bt} onClick={() => responder(true)}>Ouvi</button>
              <button className="btn" style={S.bt} onClick={() => responder(false)}>Não ouvi</button>
            </div>
          )}
        </div>
        <LinhaDoMonitor />
        <div style={S.aviso}>
          APK de teste. Quando o som sumir: toque no 🔊, depois aqui e em <b>Registrar falha de som</b> — antes de
          qualquer outra coisa. Nada é enviado sozinho: você copia ou compartilha.
        </div>
        <div style={S.aviso}>
          Falhas registradas: {ocorrencias.length} · eventos na fita: {diagAudio.fita().length}
        </div>

        <div style={S.linha}>
          <button className="btn gold" style={S.falha} onClick={registrar}>Registrar falha de som</button>
          <button className="btn" style={S.bt} disabled={ocupado} onClick={() => testar("musica")}>Testar música</button>
          <button className="btn" style={S.bt} disabled={ocupado} onClick={() => testar("efeito")}>Testar efeito</button>
        </div>

        <div style={S.aviso}>
          Testes por camada (faça os quatro, ANTES de Tentar recuperar): A = Web Audio isolado · A′ = direto no motor ·
          B = áudio HTML5 · C = Android nativo · D = Testar música / Testar efeito (motor do KING). Depois de cada um, responda Ouvi / Não ouvi.
        </div>
        <div style={S.aviso}>
          Rodada 7 (contexto do KING): R mede os relógios por 60 s · I1 para a música · I2 isola o grafo (ambos tocam
          A′ no fim) · Restaurar religa tudo · Escada monta o grafo do KING peça por peça (E1…E5) num contexto limpo.
        </div>
        <div style={S.linha}>
          <button className="btn" style={S.bt} disabled={ocupado} onClick={() => diferencial("R")}>R · Medir relógios (60 s)</button>
          <button className="btn" style={S.bt} disabled={ocupado} onClick={() => diferencial("I1")}>I1 · Parar música + A′</button>
          <button className="btn" style={S.bt} disabled={ocupado} onClick={() => diferencial("I2")}>I2 · Isolar grafo + A′</button>
          <button className="btn ghost" style={S.bt} disabled={ocupado} onClick={restaurarMotor}>Restaurar motor</button>
          <button className="btn" style={S.bt} disabled={ocupado} onClick={() => diferencial(proximoDegrau())}>Escada: próximo degrau ({proximoDegrau()})</button>
          <button className="btn ghost" style={S.bt} disabled={ocupado} onClick={encerrarEscada}>Encerrar escada</button>
        </div>
        <div style={S.aviso}>
          Rodada 8 (variantes do grafo, no próprio motor — um contexto de cada vez): toque em cada uma, ouça ~23 s
          e responda se a música e os bips tocaram normais. No fim: Perfil automático (a correção).
        </div>
        <div style={S.linha}>
          {(Object.keys(VARIANTES_DO_PAINEL) as (keyof typeof VARIANTES_DO_PAINEL)[]).map((l) => (
            <button key={l} className="btn" style={S.bt} disabled={ocupado} onClick={() => diferencial(l)}>{VARIANTES_DO_PAINEL[l].nome.split(" (")[0]}</button>
          ))}
          <button className="btn ghost" style={S.bt} disabled={ocupado} onClick={perfilAutomatico}>Perfil automático (a correção)</button>
        </div>
        <div style={S.linha}>
          <button className="btn" style={S.bt} disabled={ocupado} onClick={() => diferencial("A")}>A · Web Audio isolado</button>
          <button className="btn" style={S.bt} disabled={ocupado} onClick={() => diferencial("A′")}>A′ · Direto no motor</button>
          <button className="btn" style={S.bt} disabled={ocupado} onClick={() => diferencial("B")}>B · Áudio HTML5</button>
          <button className="btn" style={S.bt} disabled={ocupado} onClick={() => diferencial("C")}>C · Android nativo</button>
          <button className="btn ghost" style={S.bt} onClick={lerSistemaAgora}>Ler áudio do sistema</button>
        </div>

        <div style={S.linha}>
          <button className="btn" style={S.bt} disabled={ocupado} onClick={recuperar}>Tentar recuperar</button>
          <button className="btn" style={S.bt} onClick={copiar}>Copiar diagnóstico</button>
          {podeCompartilhar(nav)
            ? <button className="btn" style={S.bt} onClick={compartilhar}>Compartilhar diagnóstico</button>
            : <button className="btn ghost" style={S.bt} onClick={gerar}>Mostrar texto</button>}
        </div>

        {texto !== null && (
          <textarea
            readOnly
            value={texto}
            style={S.texto}
            aria-label="Texto do diagnóstico"
            onFocus={(e) => e.currentTarget.select()}
          />
        )}

        <div style={{ marginTop: 10 }}>
          <button className="btn ghost" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
