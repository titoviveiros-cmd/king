// A CHAVE — todas as fases lado a lado, com o caminho do jogador em ouro.
//
// Lê-se sem animação: cada mesa diz quem senta, quem passou (✓ e o texto "avança") e a pontuação
// de quem já jogou. Fases que ainda não existem aparecem como vagas "a definir" — a pessoa vê o
// tamanho do caminho desde a primeira tela. Rola por dentro (as 8 mesas da Copa não cabem em 393px
// de altura), e nunca de lado na página.
import { desenhoDoAvatar } from "../ui/avatares.js";
import { FORMATOS, mesasNaFase, CLASSIFICADOS_POR_MESA } from "./formatos.js";
import {
  ID_DO_HUMANO, mesasDaFase, temHumano, classificou, type MesaDoTorneio, type Torneio,
} from "./orquestrador.js";

export function nomeDaMesa(t: Torneio, m: Pick<MesaDoTorneio, "fase" | "indice">): string {
  const f = FORMATOS[t.formato];
  const total = mesasNaFase(f, m.fase);
  if (total === 1) return f.fases[m.fase];
  if (m.fase === 0) return `Mesa ${m.indice + 1}`;
  return `${f.fases[m.fase]} ${m.indice + 1}`;
}

export function Chave({ torneio: t }: { torneio: Torneio }) {
  const f = FORMATOS[t.formato];
  return (
    <div className="tn-chave" role="region" aria-label={`Chave ${f.doNome}`} tabIndex={0}>
      {f.fases.map((nomeDaFase, fase) => {
        const mesas = mesasDaFase(t, fase);
        const vagas = mesasNaFase(f, fase);
        return (
          <section key={fase} className="tn-col" aria-label={nomeDaFase}>
            <h3 className="tn-col-titulo">{nomeDaFase}</h3>
            <div className="tn-col-mesas">
              {Array.from({ length: vagas }, (_, i) => {
                const m = mesas.find((x) => x.indice === i);
                return m
                  ? <CartaoDaMesa key={i} torneio={t} mesa={m} />
                  : (
                    <div key={i} className="tn-mesa tn-mesa-vaga" aria-label={`${nomeDaMesa(t, { fase, indice: i })}: a definir`}>
                      <span className="tn-mesa-nome">{nomeDaMesa(t, { fase, indice: i })}</span>
                      <span className="tn-vaga">a definir</span>
                    </div>
                  );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function CartaoDaMesa({ torneio: t, mesa: m }: { torneio: Torneio; mesa: MesaDoTorneio }) {
  const minha = temHumano(m);
  // Com resultado, a ordem é a da classificação (com desempate); sem, a dos assentos.
  const ordem = m.resultado ? m.resultado.classificacao.ordem : m.assentos;
  const pontosDe = (id: number) => (m.resultado ? m.resultado.fatos.pontos[m.assentos.indexOf(id)] : null);
  return (
    <div className={`tn-mesa ${minha ? "tn-meu-caminho" : ""}`} aria-label={`${nomeDaMesa(t, m)}${minha ? " — a sua mesa" : ""}`}>
      <span className="tn-mesa-nome">{nomeDaMesa(t, m)}{!m.resultado && <em> · a jogar</em>}</span>
      <ol className="tn-mesa-lista">
        {ordem.map((id, pos) => {
          const p = t.participantes[id];
          // Na FINAL só um "passa": o campeão leva a coroa, e o 2º não ganha o ✓ de quem avança.
          const final = mesasNaFase(FORMATOS[t.formato], m.fase) === 1;
          const passou = m.resultado ? (final ? pos === 0 : classificou(m, id)) : false;
          const pts = pontosDe(id);
          return (
            <li
              key={id}
              className={`tn-linha ${passou ? "tn-passou" : ""} ${m.resultado && pos >= (final ? 1 : CLASSIFICADOS_POR_MESA) ? "tn-caiu" : ""} ${id === ID_DO_HUMANO ? "tn-eu" : ""}`}
            >
              <span className="tn-av" aria-hidden>{desenhoDoAvatar(p.avatar).glifo}</span>
              <span className="tn-nome">{p.nome}</span>
              {pts !== null && <span className="tn-pts">{pts}</span>}
              {passou && (final
                ? <span className="tn-selo" aria-label="campeão">♛</span>
                : <span className="tn-selo" aria-label="avança">✓</span>)}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
