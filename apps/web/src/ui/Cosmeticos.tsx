// A VITRINE DOS ITENS DA COROA (Entrega B) e a celebração "NOVO ITEM DESBLOQUEADO!".
//
// Enxuta de propósito: uma seção por CATEGORIA (molduras, baralhos, mesas, reações), cada cartão
// dizendo UMA coisa — bloqueado (e em que nível libera), desbloqueado/livre ou em uso — e um botão.
// No topo, quanto falta para o PRÓXIMO desbloqueio: a progressão aparece sem virar painel. Nada de loja, preço, moeda, sorteio ou "falta pouco":
// o único caminho para um item é jogar online e subir de nível, e a vitrine diz isso com todas as
// letras, para ninguém achar que uma partida contra os bots vai liberar alguma coisa.
import { useEffect, useRef, useState } from "react";
import { sfxTap } from "../audio/sounds.js";
import { Crown } from "./Crown.js";
import {
  CATALOGO, CATEGORIAS, DESBLOQUEAVEIS, estadoDoItem, liberadosNo, proximoDesbloqueio,
  type Equipados, type ItemDoCatalogo, type ItemId,
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
  const toalha = CATALOGO.find((i) => i.id === id)?.toalha;
  // a MESA: um pedaço oval da toalha, com os MESMOS tokens do pano da partida
  if (toalha) return <span className="it-amostra" aria-hidden><span className="it-mesa tema-amostra" data-tema={toalha}><i /></span></span>;
  if (id === "moldura-real") return <span className="it-amostra" aria-hidden><span className="sl-av s0 moldura-real">🦁</span></span>;
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

/**
 * Um cartão da vitrine. Nas categorias EXCLUSIVAS (a mesa), o item em uso não tem botão — escolher
 * outro é que troca —, e os de nível 1 aparecem como "Livre".
 */
function ItemDaVitrine({ item, exclusiva, nivel, equipados, ocupado, onEquipar }: {
  item: ItemDoCatalogo;
  exclusiva: boolean;
  nivel: number;
  equipados: Equipados;
  ocupado: boolean;
  onEquipar: (item: ItemId, equipado: boolean) => void;
}) {
  const estado = estadoDoItem(item, nivel, equipados);
  const rotulo = estado === "bloqueado" ? `🔒 Nível ${item.nivel}`
    : exclusiva ? (estado === "equipado" ? "Em uso" : item.nivel <= 1 ? "Livre" : "Desbloqueado")
    : ROTULO[estado];
  const comBotao = estado !== "bloqueado" && !(exclusiva && estado === "equipado");
  return (
    <li className={`it-item ${estado}`} data-item={item.id}>
      <AmostraDoItem id={item.id} />
      <span className="it-texto">
        <b className="it-nome">{item.nome}</b>
        <span className="it-desc">{item.descricao}</span>
      </span>
      <span className="it-lado">
        <span className="it-estado">{rotulo}</span>
        {comBotao && (
          <button
            className={`btn ${estado === "equipado" ? "ghost" : "gold"} it-botao`}
            disabled={ocupado}
            aria-pressed={estado === "equipado"}
            onClick={() => { sfxTap(); onEquipar(item.id, estado !== "equipado"); }}
          >
            {exclusiva ? "Usar" : estado === "equipado" ? "Desequipar" : "Equipar"}
          </button>
        )}
      </span>
    </li>
  );
}

export function VitrineDeItens({ nivel, equipados, ocupado, aviso, onEquipar, onFechar }: {
  nivel: number;
  equipados: Equipados;
  ocupado: boolean;
  aviso: string | null;
  onEquipar: (item: ItemId, equipado: boolean) => void;
  onFechar: () => void;
}) {
  const proximo = proximoDesbloqueio(nivel);
  return (
    <div className="ov" onClick={onFechar}>
      <div className="ovcard itens" role="dialog" aria-modal="true" aria-labelledby="it-titulo" onClick={(e) => e.stopPropagation()}>
        <h2 id="it-titulo">Itens da Coroa</h2>
        <div className="sub">Nível {nivel} · {liberadosNo(nivel).length} de {DESBLOQUEAVEIS.length} desbloqueados</div>
        {/* A PROGRESSÃO, numa linha: o próximo item e em que nível. Sem contagem regressiva. */}
        <p className="it-proximo" data-proximo={proximo?.id ?? ""}>
          {proximo ? <>Próximo: <b>{proximo.nome}</b> no nível {proximo.nivel}</> : <b>Todos os itens da Coroa desbloqueados</b>}
        </p>
        <div className="it-lista">
          {CATEGORIAS.map((cat) => (
            <section key={cat.id} className={`it-categoria cat-${cat.id}`} aria-labelledby={`it-cat-${cat.id}`}>
              <h3 id={`it-cat-${cat.id}`} className="it-cat-titulo">{cat.nome}</h3>
              <ul className={`it-itens${cat.exclusiva ? " exclusiva" : ""}`}>
                {CATALOGO.filter((i) => i.categoria === cat.id).map((item) => (
                  <ItemDaVitrine key={item.id} item={item} exclusiva={cat.exclusiva} nivel={nivel}
                    equipados={equipados} ocupado={ocupado} onEquipar={onEquipar} />
                ))}
              </ul>
            </section>
          ))}
        </div>
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
