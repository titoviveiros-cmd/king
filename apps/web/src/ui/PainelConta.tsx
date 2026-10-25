// O PAINEL "CONTA" (Fase 9) — salvar o progresso, "Já tenho uma conta" e excluir a conta.
//
// Abre por cima da Home, como o painel de Som e vibração, e com a mesma moldura (`.ov`/`.ovcard`).
// É a resposta às duas lojas: a exclusão fica a um toque do topo da Home (App Store 5.1.1(v);
// Google Play "Account deletion"), com explicação clara do que some e do que fica, e confirmação
// forte — digitar EXCLUIR. Os verbos importam: "Salvar" para vincular (a conta é a mesma), "Entrar"
// só para "Já tenho uma conta" (é aí que se troca de conta, e só depois de confirmar).
//
// O painel não conhece SDK, token nem plugin: recebe operações prontas (`useConta`,
// `usePainelDaConta`) e devolve frases neutras — nunca um identificador.
import { useState } from "react";
import type { ProvedorVinculavel } from "../auth/conta.js";
import type { RevogacaoApple, ResultadoDaExclusao } from "../auth/exclusaoDeConta.js";
import type { ContaDaHome, ServicosDaConta } from "../auth/useConta.js";
import type { ResultadoDaRecuperacao } from "../auth/recuperacaoDeConta.js";
import { sfxTap } from "../audio/sounds.js";

export const PALAVRA_DA_EXCLUSAO = "EXCLUIR";

const NOME: Record<ProvedorVinculavel, string> = { apple: "a Apple", google: "o Google" };

type Confirmacao = Extract<ResultadoDaRecuperacao, { tipo: "confirmar" }>;
type Tela =
  | { nome: "inicio" }
  | { nome: "recuperar" }
  | { nome: "confirmar"; pendente: Confirmacao }
  | { nome: "recuperada" }
  | { nome: "excluir" }
  | { nome: "excluida"; apple: RevogacaoApple };

const AVISO_DA_RECUPERACAO: Partial<Record<string, string>> = {
  "ja-e-esta": "Essa já é a conta deste aparelho.",
  "conta-nao-encontrada": "Não há conta do KING com esse login. Para guardar o progresso deste aparelho, use \"Salvar progresso\". Nada foi alterado.",
  "erro-de-rede": "Sem conexão agora. Nada foi alterado.",
  "provedor-recusou": "O login não foi concluído. Nada foi alterado.",
  indisponivel: "Isso não está disponível agora.",
  cancelado: "Cancelado. Nada foi alterado.",
};

const AVISO_DA_EXCLUSAO: Record<Extract<ResultadoDaExclusao, { tipo: "falhou" }>["motivo"] | "sem-conta" | "cancelada", string> = {
  indisponivel: "A exclusão não está disponível agora. Sua conta continua como estava.",
  rede: "Não foi possível excluir agora. Sua conta continua como estava — tente de novo.",
  servidor: "Não foi possível excluir agora. Sua conta continua como estava — tente de novo.",
  "sessao-invalida": "Sua sessão expirou. Feche e abra o KING, e tente de novo.",
  "em-andamento": "",
  "sem-conta": "Não há conta do KING neste aparelho.",
  cancelada: "Exclusão cancelada. Nada foi alterado.",
};

/** A conta tinha Apple e a revogação não aconteceu: o caminho manual, nos Ajustes do iPhone. */
const PRECISA_DO_CAMINHO_MANUAL = new Set<RevogacaoApple>(["sem-codigo", "outra-conta", "falhou", "nao-configurada"]);

export function PainelConta({
  conta, servicos, onFechar, onRecomecar,
}: {
  /** O vínculo (ausente quando esta publicação não vincula contas). */
  conta: ContaDaHome | null;
  servicos: ServicosDaConta;
  onFechar: () => void;
  /** Depois de trocar ou excluir a conta, o app recomeça do zero (estado limpo). */
  onRecomecar: () => void;
}) {
  const [tela, setTela] = useState<Tela>({ nome: "inicio" });
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [digitado, setDigitado] = useState("");

  const vinculada = conta?.estado === "google" || conta?.estado === "apple";
  const provedoresParaVincular: ProvedorVinculavel[] = conta && !vinculada ? (conta.provedores ?? ["google"]) : [];

  const ir = (t: Tela) => { setAviso(null); setTela(t); };

  const recuperar = async (p: ProvedorVinculavel) => {
    if (!servicos.recuperacao || ocupado) return;
    setOcupado(true);
    setAviso(null);
    try {
      const r = await servicos.recuperacao.recuperar(p);
      if (r.tipo === "confirmar") { setTela({ nome: "confirmar", pendente: r }); return; }
      if (r.tipo === "recuperada") { setTela({ nome: "recuperada" }); return; }
      if (r.tipo === "ja-e-esta") { setAviso(AVISO_DA_RECUPERACAO["ja-e-esta"]!); return; }
      if (r.motivo !== "em-andamento") setAviso(AVISO_DA_RECUPERACAO[r.motivo] ?? null);
    } finally {
      setOcupado(false);
    }
  };

  const decidir = async (pendente: Confirmacao, confirmar: boolean) => {
    if (ocupado) return;
    setOcupado(true);
    try {
      if (!confirmar) {
        await pendente.cancelar();
        setTela({ nome: "recuperar" });
        setAviso(AVISO_DA_RECUPERACAO.cancelado!);
        return;
      }
      const r = await pendente.confirmar();
      if (r.tipo === "recuperada") { setTela({ nome: "recuperada" }); return; }
      setTela({ nome: "recuperar" });
      setAviso(r.tipo === "falhou" ? (AVISO_DA_RECUPERACAO[r.motivo] ?? null) : null);
    } finally {
      setOcupado(false);
    }
  };

  const excluir = async () => {
    if (!servicos.exclusao || ocupado || digitado.trim() !== PALAVRA_DA_EXCLUSAO) return;
    setOcupado(true);
    setAviso(null);
    try {
      const r = await servicos.exclusao.excluir();
      if (r.tipo === "excluida") { setTela({ nome: "excluida", apple: r.apple }); return; }
      const motivo = r.tipo === "falhou" ? r.motivo : r.tipo;
      if (AVISO_DA_EXCLUSAO[motivo]) setAviso(AVISO_DA_EXCLUSAO[motivo]);
    } finally {
      setOcupado(false);
    }
  };

  const fechar = () => {
    if (ocupado) return;
    sfxTap();
    // Trocou ou excluiu a conta: quem joga mudou, e o app recomeça limpo mesmo fechando pelo fundo.
    if (tela.nome === "recuperada" || tela.nome === "excluida") { onRecomecar(); return; }
    // No meio da confirmação: fechar é CANCELAR — a sessão nova, ainda não adotada, é revogada.
    if (tela.nome === "confirmar") void tela.pendente.cancelar();
    onFechar();
  };
  const statusDaConta = conta?.estado === "google"
    ? "Seu progresso está salvo com o Google."
    : conta?.estado === "apple"
      ? "Seu progresso está salvo com a Apple."
      : "Você joga como convidado neste aparelho.";

  return (
    <div className="ov" onClick={fechar}>
      <div className="ovcard pc" role="dialog" aria-modal="true" aria-labelledby="pc-titulo" onClick={(e) => e.stopPropagation()}>
        {tela.nome === "inicio" && (
          <>
            <h2 id="pc-titulo">Conta</h2>
            <div className="sub">{statusDaConta}</div>
            {provedoresParaVincular.length > 0 && (
              <section className="pc-secao">
                <h3>Salvar progresso</h3>
                <p className="pc-texto">Guarde seu nível e seu XP para não perder nada ao trocar de aparelho.</p>
                <div className="pc-acoes">
                  {provedoresParaVincular.map((p) => (
                    <button
                      key={p}
                      className={`pc-prov ${p}`}
                      disabled={ocupado || conta?.estado === "processando"}
                      onClick={() => { sfxTap(); conta?.onVincular(p); }}
                    >
                      {p === "apple" ? " " : ""}Continuar com {NOME[p]}
                    </button>
                  ))}
                </div>
                {conta?.aviso && <p className="pc-aviso" role="status">{conta.aviso}</p>}
              </section>
            )}
            {servicos.recuperacao && (
              <button className="pc-link" onClick={() => { sfxTap(); ir({ nome: "recuperar" }); }}>
                Já tenho uma conta
              </button>
            )}
            {aviso && <p className="pc-aviso" role="status">{aviso}</p>}
            <div className="pc-rodape">
              <button className="btn gold" onClick={fechar}>Voltar ao jogo</button>
              {servicos.exclusao && (
                <button className="pc-perigo" onClick={() => { sfxTap(); setDigitado(""); ir({ nome: "excluir" }); }}>
                  Excluir conta
                </button>
              )}
            </div>
          </>
        )}

        {tela.nome === "recuperar" && servicos.recuperacao && (
          <>
            <h2 id="pc-titulo">Já tenho uma conta</h2>
            <div className="sub">Entre na conta do KING que você salvou com Google ou Apple em outro aparelho.</div>
            <div className="pc-acoes">
              {servicos.recuperacao.provedores.map((p) => (
                <button key={p} className={`pc-prov ${p}`} disabled={ocupado} onClick={() => { sfxTap(); void recuperar(p); }}>
                  {p === "apple" ? " " : ""}Continuar com {NOME[p]}
                </button>
              ))}
            </div>
            {aviso && <p className="pc-aviso" role="status">{aviso}</p>}
            <div className="pc-rodape">
              <button className="pc-link" disabled={ocupado} onClick={() => { sfxTap(); ir({ nome: "inicio" }); }}>Voltar</button>
            </div>
          </>
        )}

        {tela.nome === "confirmar" && (
          <>
            <h2 id="pc-titulo">Trocar de conta neste aparelho?</h2>
            <p className="pc-texto">
              {tela.pendente.atualVinculada
                ? "A conta atual continua salva no seu login e pode voltar depois."
                : tela.pendente.progresso
                  ? `O progresso deste convidado (nível ${tela.pendente.progresso.nivel}, ${tela.pendente.progresso.xpTotal} XP) fica para trás e não poderá ser recuperado.`
                  : "Não foi possível conferir o progresso deste aparelho. Se houver algum, ele fica para trás e não poderá ser recuperado."}
            </p>
            <div className="pc-acoes">
              <button className="btn gold" disabled={ocupado} onClick={() => { sfxTap(); void decidir(tela.pendente, true); }}>
                Entrar na minha conta
              </button>
              <button className="pc-link" disabled={ocupado} onClick={() => { sfxTap(); void decidir(tela.pendente, false); }}>
                Cancelar
              </button>
            </div>
          </>
        )}

        {tela.nome === "recuperada" && (
          <>
            <h2 id="pc-titulo">Pronto!</h2>
            <p className="pc-texto">Você entrou na sua conta. O jogo vai recomeçar com o seu progresso.</p>
            <div className="pc-acoes">
              <button className="btn gold" onClick={() => { sfxTap(); onRecomecar(); }}>Continuar</button>
            </div>
          </>
        )}

        {tela.nome === "excluir" && (
          <>
            <h2 id="pc-titulo">Excluir conta</h2>
            <ul className="pc-lista">
              <li>Apaga para sempre a sua conta do KING: nível, XP, sequência e o vínculo com Google ou Apple.</li>
              <li>Não dá para desfazer. Se jogar de novo, começa como um convidado novo.</li>
              <li>O registro das partidas fica, sem nada que identifique você.</li>
              {conta?.estado === "apple" && conta.nativo && <li>Vamos pedir para você confirmar com a Apple.</li>}
            </ul>
            <label className="pc-campo">
              <span>Digite {PALAVRA_DA_EXCLUSAO} para confirmar</span>
              <input
                value={digitado}
                onChange={(e) => setDigitado(e.target.value)}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                disabled={ocupado}
              />
            </label>
            {aviso && <p className="pc-aviso" role="status">{aviso}</p>}
            <div className="pc-acoes">
              <button
                className="pc-excluir"
                disabled={ocupado || digitado.trim() !== PALAVRA_DA_EXCLUSAO}
                onClick={() => { sfxTap(); void excluir(); }}
              >
                {ocupado ? "Excluindo…" : "Excluir minha conta"}
              </button>
              <button className="pc-link" disabled={ocupado} onClick={() => { sfxTap(); ir({ nome: "inicio" }); }}>Cancelar</button>
            </div>
          </>
        )}

        {tela.nome === "excluida" && (
          <>
            <h2 id="pc-titulo">Conta excluída</h2>
            <p className="pc-texto">Sua conta do KING foi excluída deste aparelho e dos nossos servidores.</p>
            {PRECISA_DO_CAMINHO_MANUAL.has(tela.apple) && (
              <p className="pc-texto">
                Para tirar o KING da lista de apps que usam o seu ID Apple: Ajustes → seu nome → Iniciar Sessão com a
                Apple → KING → Parar de Usar.
              </p>
            )}
            <div className="pc-acoes">
              <button className="btn gold" onClick={() => { sfxTap(); onRecomecar(); }}>Voltar ao início</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
