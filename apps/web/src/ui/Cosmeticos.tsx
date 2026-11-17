// A VITRINE DOS ITENS DA COROA (Entrega B) e a celebração "NOVO ITEM DESBLOQUEADO!".
//
// Enxuta de propósito: três cartões, cada um dizendo UMA coisa — bloqueado (e em que nível libera),
// desbloqueado ou equipado — e um botão. Nada de loja, preço, moeda, sorteio ou "falta pouco":
// o único caminho para um item é jogar online e subir de nível, e a vitrine diz isso com todas as
// letras, para ninguém achar que uma partida contra os bots vai liberar alguma coisa.
import { useEffect, useRef, useState } from "react";
import { sfxTap } from "../audio/sounds.js";
import { Crown } from "./Crown.js";
import {
  CATALOGO, estadoDoItem, type Equipados, type ItemDoCatalogo, type ItemId,
} from "../auth/cosmeticos.js";

/** O que a vitrine diz sobre de onde vem o XP. Sem promessa que a partida solo não cumpre. */
export const ORIGEM_DO_XP = "Itens liberam com o nível. XP vem só de partidas online com outras pessoas — partidas contra os bots não contam.";

const ROTULO: Record<ReturnType<typeof estadoDoItem>, string> = {
  bloqueado: "Bloqueado",
  desbloqueado: "Desbloqueado",
  equipado: "Equipado",
};

/** A amostra de cada item — o mesmo desenho que ele terá na partida. */
export function AmostraDoItem({ id }: { id: ItemId }) {
  if (id === "moldura-real") return <span className="it-amostra" aria-hidden><span className="sl-av moldura-real">👑</span></span>;
  if (id === "baralho-imperial") {
    return (
      <span className="it-amostra it-baralho" aria-hidden>
        <span className="card back imperial" />
        <span className="card red imperial"><span className="idx"><b>A</b><span>♥</span></span><span className="pip">♥</span></span>
      </span>
    );
  }
  // Só a coroa no balão: a frase inteira não cabe na coluna da amostra e cobriria o nome do item.
  return <span className="it-amostra" aria-hidden><span className="balao coroa amostra">👑</span></span>;
}

export function VitrineDeItens({ nivel, equipados, ocupado, aviso, onEquipar, onFechar }: {
  nivel: number;
  equipados: Equipados;
  ocupado: boolean;
  aviso: string | null;
  onEquipar: (item: ItemId, equipado: boolean) => void;
  onFechar: () => void;
}) {
  return (
    <div className="ov" onClick={onFechar}>
      <div className="ovcard itens" role="dialog" aria-modal="true" aria-labelledby="it-titulo" onClick={(e) => e.stopPropagation()}>
        <h2 id="it-titulo">Itens da Coroa</h2>
        <div className="sub">Nível {nivel} · {CATALOGO.filter((i) => nivel >= i.nivel).length} de {CATALOGO.length} liberados</div>
        <ul className="it-lista">
          {CATALOGO.map((item) => {
            const estado = estadoDoItem(item, nivel, equipados);
            return (
              <li key={item.id} className={`it-item ${estado}`} data-item={item.id}>
                <AmostraDoItem id={item.id} />
                <span className="it-texto">
                  <b className="it-nome">{item.nome}</b>
                  <span className="it-desc">{item.descricao}</span>
                </span>
                <span className="it-lado">
                  <span className="it-estado">
                    {estado === "bloqueado" ? `🔒 Nível ${item.nivel}` : ROTULO[estado]}
                  </span>
                  {estado !== "bloqueado" && (
                    <button
                      className={`btn ${estado === "equipado" ? "ghost" : "gold"} it-botao`}
                      disabled={ocupado}
                      aria-pressed={estado === "equipado"}
                      onClick={() => { sfxTap(); onEquipar(item.id, estado !== "equipado"); }}
                    >
                      {estado === "equipado" ? "Desequipar" : "Equipar"}
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        {aviso && <p className="it-aviso" role="status">{aviso}</p>}
        <p className="it-origem">{ORIGEM_DO_XP}</p>
        <button className="btn gold it-fechar" onClick={() => { sfxTap(); onFechar(); }}>Voltar</button>
      </div>
    </div>
  );
}

/** Quanto a celebração fica sozinha na tela, se ninguém tocar. */
export const DURACAO_DA_CELEBRACAO_MS = 4_500;

/**
 * "NOVO ITEM DESBLOQUEADO!" — curta, uma vez por item, e nunca no meio de uma partida: ela só
 * aparece na Home, quando o nível novo é lido. Um toque fecha; "Ver itens" leva à vitrine. Não
 * toca som nem vibra (a Home pode estar em silêncio por escolha de quem joga).
 */
export function NovoItemDesbloqueado({ itens, onVer, onFechar }: {
  itens: readonly ItemDoCatalogo[];
  onVer: () => void;
  onFechar: () => void;
}) {
  const [saindo, setSaindo] = useState(false);
  const fim = useRef(onFechar);
  fim.current = onFechar;
  useEffect(() => {
    const id = window.setTimeout(() => setSaindo(true), DURACAO_DA_CELEBRACAO_MS);
    return () => window.clearTimeout(id);
  }, []);
  useEffect(() => {
    if (!saindo) return;
    const id = window.setTimeout(() => fim.current(), 300);
    return () => window.clearTimeout(id);
  }, [saindo]);

  return (
    <div className={`novoitem${saindo ? " saindo" : ""}`} onClick={() => setSaindo(true)} role="status" aria-live="polite">
      <div className="ni-cartao" onClick={(e) => e.stopPropagation()}>
        <span className="ni-coroa" aria-hidden><Crown size={44} /></span>
        <b className="ni-titulo">NOVO ITEM DESBLOQUEADO!</b>
        <ul className="ni-itens">
          {itens.map((i) => (
            <li key={i.id}><AmostraDoItem id={i.id} /><span>{i.nome}</span></li>
          ))}
        </ul>
        <div className="ni-acoes">
          <button className="btn gold" onClick={() => { sfxTap(); onVer(); }}>Ver itens</button>
          <button className="btn ghost" onClick={() => { sfxTap(); setSaindo(true); }}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
