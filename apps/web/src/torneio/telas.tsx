// AS TELAS DO MINI-TORNEIO — só apresentação. Quem decide qual aparece é `ModoTorneio`.
//
// Cada tela se lê PARADA: o que muda o jogo (quem passou, por qual critério, em que fase você
// caiu) está em texto, com papéis e rótulos. A animação (entrada, brilho, avanço no trilho) é
// enfeite por cima, e some com `prefers-reduced-motion`.
import type { ReactNode } from "react";
import { desenhoDoAvatar } from "../ui/avatares.js";
import { sfxTap } from "../audio/sounds.js";
import { FORMATOS, CLASSIFICADOS_POR_MESA, mesasNaFase, type FormatoId } from "./formatos.js";
import { CADEIA_DE_DESEMPATE, TEXTO_DO_CRITERIO, numeroDoSorteio } from "./desempate.js";
import {
  ID_DO_HUMANO, caminhoDoHumano, classificou, mesasDaFase, temHumano, type MesaDoTorneio, type Torneio,
} from "./orquestrador.js";
import { Chave, nomeDaMesa } from "./Chave.js";

const toque = (f: () => void) => () => { sfxTap(); f(); };

/**
 * "na Semifinal", "nas Quartas de final", "à Final", "às Mesas iniciais": o nome da fase com a
 * preposição contraída certa. Todas as fases são femininas; plural quando o nome é plural.
 */
export function contracao(prep: "a" | "em", fase: string): string {
  const plural = /^(Mesas|Quartas)/.test(fase);
  const artigo = prep === "a" ? (plural ? "às" : "à") : (plural ? "nas" : "na");
  return `${artigo} ${fase}`;
}

export function Moldura({
  torneio, titulo, children, onSair, rotuloSair = "Início",
}: {
  torneio?: Torneio | null;
  titulo: string;
  children: ReactNode;
  onSair: () => void;
  rotuloSair?: string;
}) {
  return (
    <div className="tn">
      <header className="tn-topo">
        <button className="tn-voltar" onClick={toque(onSair)}>← {rotuloSair}</button>
        <span className="tn-marca">{torneio ? FORMATOS[torneio.formato].nome : "Mini-torneio"}</span>
        {torneio?.qa && <span className="tn-qa" title="Semente ou mão inicial fixadas pela URL">modo de teste</span>}
      </header>
      <main className="tn-corpo" aria-label={titulo}>{children}</main>
    </div>
  );
}

function Pessoa({ torneio: t, id, extra }: { torneio: Torneio; id: number; extra?: ReactNode }) {
  const p = t.participantes[id];
  const d = desenhoDoAvatar(p.avatar);
  return (
    <span className={`tn-pessoa ${p.humano ? "tn-eu" : ""}`}>
      <span className="tn-av" role="img" aria-label={d.rotulo}>{d.glifo}</span>
      <span className="tn-nome">{p.nome}{!p.humano && <span className="tn-bot"> bot</span>}</span>
      {extra}
    </span>
  );
}

// ───────────────────────────── escolha do formato ─────────────────────────────

export function TelaEscolha({ onEscolher, onSair, aviso }: {
  onEscolher: (f: FormatoId) => void; onSair: () => void; aviso?: string | null;
}) {
  const cartao = (id: FormatoId, destaque: string) => {
    const f = FORMATOS[id];
    return (
      <button
        key={id}
        className={`tn-formato tn-formato-${id}`}
        aria-label={`${f.nome}: ${f.participantes} participantes, ${f.fases.length} partidas até o título`}
        onClick={toque(() => onEscolher(id))}
      >
        <span className="tn-formato-nome">{f.nome}</span>
        <span className="tn-formato-num">{f.participantes}</span>
        <span className="tn-formato-desc">
          {f.participantes / 4} mesas · {f.fases.length} partidas até o título
        </span>
        <span className="tn-formato-fases">{f.fases.join(" → ")}</span>
        <span className="tn-formato-tag">{destaque}</span>
      </button>
    );
  };
  return (
    <Moldura titulo="Escolha o formato" onSair={onSair}>
      <h1 className="tn-h1">Escolha o seu torneio</h1>
      <p className="tn-sub">Você e bots, mesas de 4, as 10 mãos oficiais. Os <b>2 primeiros</b> de cada mesa avançam.</p>
      {aviso && <p className="tn-aviso" role="alert">{aviso}</p>}
      <div className="tn-formatos">
        {cartao("mini16", "rápido")}
        {cartao("copa32", "completo")}
      </div>
    </Moldura>
  );
}

// ───────────────────────────── apresentação ─────────────────────────────

export function TelaApresentacao({ torneio: t, onComecar, onSair }: { torneio: Torneio; onComecar: () => void; onSair: () => void }) {
  const f = FORMATOS[t.formato];
  return (
    <Moldura torneio={t} titulo="Participantes" onSair={onSair}>
      <h1 className="tn-h1">{f.participantes} na disputa</h1>
      <p className="tn-sub">{f.fases.join(" → ")} · {f.fases.length} partidas no seu caminho</p>
      <ul className="tn-elenco" aria-label="Participantes">
        {t.participantes.map((p) => (
          <li key={p.id} style={{ ["--tn-i" as string]: p.id }}><Pessoa torneio={t} id={p.id} /></li>
        ))}
      </ul>
      <div className="tn-acoes">
        <button className="btn gold" autoFocus onClick={toque(onComecar)}>Sortear as mesas</button>
      </div>
    </Moldura>
  );
}

// ───────────────────────────── chave ─────────────────────────────

export function TelaChave({ torneio: t, aviso, acao, onSair }: {
  torneio: Torneio; aviso?: string | null; acao: { rotulo: string; onClick: () => void } | null; onSair: () => void;
}) {
  return (
    <Moldura torneio={t} titulo="Chave do torneio" onSair={onSair}>
      {aviso && <p className="tn-aviso" role="status">{aviso}</p>}
      <Chave torneio={t} />
      {acao && (
        <div className="tn-acoes">
          <button className="btn gold" autoFocus onClick={toque(acao.onClick)}>{acao.rotulo}</button>
        </div>
      )}
    </Moldura>
  );
}

// ───────────────────────────── preparando ─────────────────────────────

export function TelaPreparando({ torneio: t, feitas, total, onSair }: { torneio: Torneio; feitas: number; total: number; onSair: () => void }) {
  const pct = total ? Math.round((feitas / total) * 100) : 0;
  return (
    <Moldura torneio={t} titulo="Jogando as outras mesas" onSair={onSair}>
      <h1 className="tn-h1">As outras mesas estão jogando…</h1>
      <p className="tn-sub">Partidas reais entre bots, as 10 mãos de cada uma.</p>
      <div className="tn-barra" role="progressbar" aria-label="Partidas das outras mesas" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="tn-sub" role="status">{feitas} de {total} mãos</p>
    </Moldura>
  );
}

// ───────────────────────────── introdução do confronto ─────────────────────────────

export function TelaConfronto({ torneio: t, mesa, aviso, onJogar, onChave, onSair }: {
  torneio: Torneio; mesa: MesaDoTorneio; aviso?: string | null; onJogar: () => void; onChave: () => void; onSair: () => void;
}) {
  const f = FORMATOS[t.formato];
  const final = mesasNaFase(f, mesa.fase) === 1;
  return (
    <Moldura torneio={t} titulo={final ? "Grande final" : nomeDaMesa(t, mesa)} onSair={onSair}>
      <div className={`tn-confronto ${final ? "tn-grande-final" : ""}`}>
        <p className="tn-fase-rotulo">{final ? "a decisão" : `${f.fases[mesa.fase]} · fase ${mesa.fase + 1} de ${f.fases.length}`}</p>
        <h1 className="tn-h1 tn-h1-grande">{final ? "GRANDE FINAL" : nomeDaMesa(t, mesa)}</h1>
        {aviso && <p className="tn-aviso" role="status">{aviso}</p>}
        <ul className="tn-adversarios" aria-label="Quem senta nesta mesa">
          {mesa.assentos.map((id, i) => (
            <li key={id} style={{ ["--tn-i" as string]: i }}><Pessoa torneio={t} id={id} /></li>
          ))}
        </ul>
        <p className="tn-sub">{final ? "Quem terminar em 1º é o campeão." : `Os ${CLASSIFICADOS_POR_MESA} primeiros avançam.`}</p>
        <div className="tn-acoes">
          <button className="btn gold" autoFocus onClick={toque(onJogar)}>▶ Jogar</button>
          <button className="btn violet" onClick={toque(onChave)}>Ver a chave</button>
        </div>
      </div>
    </Moldura>
  );
}

// ───────────────────────────── classificação ─────────────────────────────

export function TelaClassificacao({ torneio: t, mesa, onContinuar, onSair }: {
  torneio: Torneio; mesa: MesaDoTorneio; onContinuar: () => void; onSair: () => void;
}) {
  const r = mesa.resultado!;
  const final = mesasNaFase(FORMATOS[t.formato], mesa.fase) === 1;
  const eu = r.classificacao.ordem.indexOf(ID_DO_HUMANO);
  const outras = mesasDaFase(t, mesa.fase).filter((m) => m.id !== mesa.id && m.resultado);
  const pts = (id: number) => r.fatos.pontos[mesa.assentos.indexOf(id)];
  const neg = (id: number) => r.fatos.negativas[mesa.assentos.indexOf(id)];
  const ile = (id: number) => r.fatos.ilesas[mesa.assentos.indexOf(id)];
  const nome = (id: number) => t.participantes[id].nome;
  return (
    <Moldura torneio={t} titulo="Classificação da mesa" onSair={onSair}>
      <h1 className="tn-h1">{final ? "Final" : nomeDaMesa(t, mesa)} · classificação</h1>
      <p className="tn-sub" role="status">
        {eu === 0 && final ? "Você venceu a final!" : eu < CLASSIFICADOS_POR_MESA ? `Você terminou em ${eu + 1}º e avança.` : `Você terminou em ${eu + 1}º.`}
      </p>
      <ol className="tn-tabela" aria-label="Classificação">
        {r.classificacao.ordem.map((id, pos) => (
          <li key={id} className={`${pos < CLASSIFICADOS_POR_MESA ? "tn-passou" : "tn-caiu"} ${id === ID_DO_HUMANO ? "tn-eu" : ""}`}>
            <span className="tn-pos">{pos + 1}º</span>
            <Pessoa torneio={t} id={id} />
            <span className="tn-pts">{pts(id)} pts</span>
            <span className="tn-situacao">{pos === 0 && final ? "campeão" : pos < CLASSIFICADOS_POR_MESA && !final ? "avança" : final ? "" : "eliminado"}</span>
          </li>
        ))}
      </ol>
      {r.classificacao.desempates.length > 0 && (
        <div className="tn-desempate" role="note" aria-label="Desempate">
          {r.classificacao.desempates.map((d) => (
            <p key={`${d.acima}-${d.abaixo}`}>
              <b>Empate em {pts(d.acima)} pts:</b> {nome(d.acima)} ficou à frente de {nome(d.abaixo)} — {TEXTO_DO_CRITERIO[d.criterio]}
              {d.criterio === "negativas" && ` (${neg(d.acima)} × ${neg(d.abaixo)})`}
              {d.criterio === "ilesas" && ` (${ile(d.acima)} × ${ile(d.abaixo)})`}
              {d.criterio === "sorteio" && ` (${numeroDoSorteio(mesa.semente, d.acima)} < ${numeroDoSorteio(mesa.semente, d.abaixo)})`}.
            </p>
          ))}
          <p className="tn-cadeia">Ordem de desempate: {CADEIA_DE_DESEMPATE.map((c, i) => `${i + 1}) ${c}`).join(" · ")}.</p>
        </div>
      )}
      {outras.length > 0 && (
        <div className="tn-outras" aria-label="Outras mesas da fase">
          <span className="tn-outras-titulo">Outras mesas</span>
          {outras.map((m) => (
            <span key={m.id} className="tn-outra">
              <b>{nomeDaMesa(t, m)}:</b> {m.resultado!.classificacao.ordem.slice(0, CLASSIFICADOS_POR_MESA).map(nome).join(" e ")} avançam
            </span>
          ))}
        </div>
      )}
      <div className="tn-acoes">
        <button className="btn gold" autoFocus onClick={toque(onContinuar)}>Continuar</button>
      </div>
    </Moldura>
  );
}

// ───────────────────────────── trilho do caminho ─────────────────────────────

function Trilho({ torneio: t, faseAtual, caiu }: { torneio: Torneio; faseAtual: number; caiu?: boolean }) {
  const f = FORMATOS[t.formato];
  return (
    <ol className="tn-trilho" aria-label="O seu caminho">
      {f.fases.map((nome, i) => {
        const estado = i < faseAtual ? "feito" : i === faseAtual ? (caiu ? "caiu" : "atual") : "futuro";
        return (
          <li key={nome} className={`tn-etapa tn-etapa-${estado}`} aria-current={i === faseAtual ? "step" : undefined}>
            <span className="tn-etapa-ponto" aria-hidden>{estado === "feito" ? "✓" : estado === "caiu" ? "✕" : i + 1}</span>
            <span className="tn-etapa-nome">{nome}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function TelaAvanco({ torneio: t, fase, onContinuar, onSair }: { torneio: Torneio; fase: number; onContinuar: () => void; onSair: () => void }) {
  const f = FORMATOS[t.formato];
  const final = fase === f.fases.length - 1;
  return (
    <Moldura torneio={t} titulo="Você avançou" onSair={onSair}>
      <div className="tn-avanco">
        <p className="tn-fase-rotulo">classificado!</p>
        <h1 className="tn-h1 tn-h1-grande">{final ? "Você está na FINAL!" : `Rumo ${contracao("a", f.fases[fase])}`}</h1>
        <Trilho torneio={t} faseAtual={fase} />
        <div className="tn-acoes">
          <button className="btn gold" autoFocus onClick={toque(onContinuar)}>Continuar</button>
        </div>
      </div>
    </Moldura>
  );
}

export function TelaEliminado({ torneio: t, onVerResto, onNovo, onSair }: {
  torneio: Torneio; onVerResto: (() => void) | null; onNovo: () => void; onSair: () => void;
}) {
  const f = FORMATOS[t.formato];
  const ultima = caminhoDoHumano(t).slice(-1)[0];
  const pos = ultima.resultado!.classificacao.ordem.indexOf(ID_DO_HUMANO) + 1;
  return (
    <Moldura torneio={t} titulo="Eliminado" onSair={onSair}>
      <div className="tn-eliminado">
        <p className="tn-fase-rotulo">fim da linha</p>
        <h1 className="tn-h1">Você caiu {contracao("em", f.fases[ultima.fase])}</h1>
        <p className="tn-sub" role="status">Terminou em {pos}º em {nomeDaMesa(t, ultima)}. Só os {CLASSIFICADOS_POR_MESA} primeiros avançavam.</p>
        <Trilho torneio={t} faseAtual={ultima.fase} caiu />
        <div className="tn-acoes">
          {onVerResto && <button className="btn gold" autoFocus onClick={toque(onVerResto)}>Ver quem será o campeão</button>}
          <button className="btn violet" onClick={toque(onNovo)}>Novo mini-torneio</button>
        </div>
      </div>
    </Moldura>
  );
}

// ───────────────────────────── fim (estático) ─────────────────────────────

export function TelaFim({ torneio: t, campeaoId, onNovo, onChave, onSair }: {
  torneio: Torneio; campeaoId: number; onNovo: () => void; onChave: () => void; onSair: () => void;
}) {
  const f = FORMATOS[t.formato];
  const p = t.participantes[campeaoId];
  const d = desenhoDoAvatar(p.avatar);
  const venci = campeaoId === ID_DO_HUMANO;
  const minha = caminhoDoHumano(t).slice(-1)[0] as MesaDoTorneio | undefined;
  return (
    <Moldura torneio={t} titulo="Resultado do torneio" onSair={onSair}>
      <div className={`tn-fim ${venci ? "tn-fim-venci" : ""}`}>
        <span className="tn-trofeu" aria-hidden>🏆</span>
        <h1 className={`tn-h1 tn-h1-grande ${venci ? "tn-caixa-alta" : ""}`}>{venci ? f.tituloDoCampeao : `Campeão: ${p.nome}`}</h1>
        {venci && <p className="tn-sub tn-vitoria">{f.fraseDaVitoria}</p>}
        <p className="tn-campeao-linha">
          <span className="tn-av" role="img" aria-label={d.rotulo}>{d.glifo}</span> {p.nome}
        </p>
        {!venci && minha?.resultado && (
          <p className="tn-sub">
            {minha.fase === f.fases.length - 1 && classificou(minha, ID_DO_HUMANO)
              ? "Você foi vice-campeão."
              : `Você parou ${contracao("em", f.fases[minha.fase])} (${minha.resultado.classificacao.ordem.indexOf(ID_DO_HUMANO) + 1}º).`}
          </p>
        )}
        <div className="tn-acoes">
          <button className="btn gold" autoFocus onClick={toque(onNovo)}>Começar outro mini-torneio</button>
          <button className="btn violet" onClick={toque(onChave)}>Ver a chave</button>
          <button className="btn violet" onClick={toque(onSair)}>Home</button>
        </div>
      </div>
    </Moldura>
  );
}

/** A mesa do humano numa fase, se houver. */
export const minhaMesaNaFase = (t: Torneio, fase: number): MesaDoTorneio | undefined =>
  mesasDaFase(t, fase).find(temHumano);
