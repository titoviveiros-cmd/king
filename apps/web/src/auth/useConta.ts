// A CONTA VISTA PELA TELA — estados e verbos.
//
// O componente não conhece Supabase, não conhece token e não conhece PKCE. Ele sabe se há uma
// conta vinculada, se algo está em curso, e como pedir o vínculo. Toda a mecânica mora em
// `conta.ts`, e é lá que ela é testada sem navegador.
//
// O retorno do Google é processado UMA vez, na montagem, ANTES de o estado ser lido: quem volta
// do provedor precisa ver a Home já com o desfecho, e a URL precisa sair limpa antes de qualquer
// coisa gravar histórico.
//
// FASE 9: além de vincular, o painel "Conta" — "Já tenho uma conta" (só no app) e "Excluir conta"
// (sempre que houver identidade configurada: convidado também é conta). Ver `usePainelDaConta`.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ContaDoJogador, MotivoDaFalha, ProvedorVinculavel } from "./conta.js";
import { ehAppNativo, fonteNativa, gerarNonce } from "./credencialNativa.js";
import type { ExclusaoDeConta, ResultadoDaExclusao } from "./exclusaoDeConta.js";
import { contaConfigurada, provedoresDaConta } from "./identidade.js";
import type { RecuperacaoDeConta, ResultadoDaRecuperacao } from "./recuperacaoDeConta.js";
import { exclusaoConfigurada, haContaNesteAparelho, recuperacaoConfigurada } from "./servicosDaConta.js";

export type EstadoVisivelDaConta = "guest" | "google" | "apple" | "processando" | "erro";

export interface ContaDaHome {
  estado: EstadoVisivelDaConta;
  /** Frase neutra para a tela, ou `null`. Nunca carrega detalhe técnico nem identificador. */
  aviso: string | null;
  /** Sem provedor: o da plataforma (Google na web; no app, o primeiro oferecido). */
  onVincular: (provedor?: ProvedorVinculavel) => void;
  /** Os provedores oferecidos para vincular, na ordem de exibição. Ausente = só o Google (web). */
  provedores?: ProvedorVinculavel[];
  /** No app, "Salvar progresso" abre o painel (onde a Apple vem primeiro no iPhone). */
  nativo?: boolean;
}

/**
 * FRASES NEUTRAS, DE PROPÓSITO.
 *
 * O jogador não precisa saber se faltou verificador PKCE ou se o usuário voltou trocado — precisa
 * saber que não deu certo e que o jogo continua dele. O motivo técnico vive no tipo, é conferido
 * em teste, e não vai para a tela.
 */
const AVISOS: Record<MotivoDaFalha, string> = {
  indisponivel: "Salvar o progresso não está disponível agora.",
  "sem-sessao": "Entre numa sala uma vez antes de salvar o progresso.",
  "sem-transacao": "Não foi possível concluir. Tente de novo.",
  "callback-invalido": "Não foi possível concluir. Tente de novo.",
  "troca-de-usuario": "A conta que voltou não é a mesma deste aparelho. O vínculo não foi feito.",
  "nao-vinculado": "O progresso não ficou salvo. Tente de novo.",
  "provedor-recusou": "O login não foi concluído. Tente de novo.",
  cancelado: "Cancelado. O jogo continua do mesmo jeito.",
  "identidade-de-outra-conta": "Essa conta já está ligada a outro jogador do KING. Para jogar com ela, use \"Já tenho uma conta\". Nada foi alterado aqui.",
};

export function useConta(): ContaDaHome | null {
  const conta = useRef<ContaDoJogador | null>(null);
  if (conta.current === null) conta.current = contaConfigurada();
  const disponivel = conta.current !== null;

  const [estado, setEstado] = useState<EstadoVisivelDaConta>("processando");
  const [aviso, setAviso] = useState<string | null>(null);
  const jaProcessou = useRef(false);
  const emCurso = useRef(false);

  useEffect(() => {
    const c = conta.current;
    if (!c || jaProcessou.current) return;
    jaProcessou.current = true;
    let vivo = true;
    void (async () => {
      const retorno = await c.concluirRetornoOAuth();
      if (!vivo) return;
      if (retorno.tipo === "erro") setAviso(AVISOS[retorno.motivo]);
      const atual = await c.obterEstadoDaConta();
      if (!vivo) return;
      setEstado(atual === "indisponivel" ? "erro" : atual === "processando" ? "processando" : atual);
    })();
    return () => { vivo = false; };
  }, []);

  const onVincular = useCallback((escolhido?: ProvedorVinculavel) => {
    const c = conta.current;
    // Toque duplo: o segundo toque, antes de a tela redesenhar o botão desabilitado, não faz nada.
    if (!c || emCurso.current) return;
    emCurso.current = true;
    setAviso(null);
    setEstado("processando");
    void (async () => {
      try {
        // No app: credencial nativa (sem sair da tela); na web: redirecionamento para o Google.
        if (ehAppNativo()) {
          const provedor = escolhido ?? provedoresDaConta()[0];
          if (!provedor) { setAviso(AVISOS.indisponivel); setEstado("guest"); return; }
          const n = await c.vincularNoApp(provedor, fonteNativa(), () => gerarNonce());
          if (n.ok) { setEstado(provedor); return; }
          setAviso(AVISOS[n.motivo]);
          setEstado("guest");
          return;
        }
        const r = await c.vincularGoogle();
        if (r.ok && r.jaVinculado) { setEstado("google"); return; }
        if (r.ok) return; // o navegador está saindo para o Google; a tela não muda mais
        setAviso(AVISOS[r.motivo]);
        setEstado("guest");
      } finally {
        emCurso.current = false;
      }
    })();
  }, []);

  if (!disponivel) return null;
  return { estado, aviso, onVincular, provedores: provedoresDaConta(), nativo: ehAppNativo() };
}

/** O que o painel "Conta" recebe: os serviços que esta publicação oferece, ou `null`. */
export interface ServicosDaConta {
  /** "Já tenho uma conta" — só no app, com o vínculo ligado. */
  recuperacao: { provedores: ProvedorVinculavel[]; recuperar: (p: ProvedorVinculavel) => Promise<ResultadoDaRecuperacao> } | null;
  /** "Excluir conta" — sempre que houver identidade configurada. */
  exclusao: { excluir: () => Promise<ResultadoDaExclusao> } | null;
}

/**
 * OS SERVIÇOS DO PAINEL "CONTA" e se o painel deve ser oferecido.
 *
 * O painel aparece quando há o que gerenciar: no app, sempre que houver identidade (a exclusão é
 * exigência das lojas); na web, só se este navegador já tem uma conta (quem nunca entrou online não
 * tem conta para excluir — e a página pública /excluir-conta cobre o resto).
 */
export function usePainelDaConta(): { oferecer: boolean; servicos: ServicosDaConta } {
  const servicos = useRef<{ recuperacao: RecuperacaoDeConta | null; exclusao: ExclusaoDeConta | null } | null>(null);
  if (servicos.current === null) servicos.current = { recuperacao: recuperacaoConfigurada(), exclusao: exclusaoConfigurada() };
  const { recuperacao, exclusao } = servicos.current;
  const oferecer = !!exclusao && (ehAppNativo() || haContaNesteAparelho());
  return {
    oferecer,
    servicos: {
      recuperacao: recuperacao ? { provedores: provedoresDaConta(), recuperar: (p) => recuperacao.recuperar(p) } : null,
      exclusao: exclusao ? { excluir: () => exclusao.excluir() } : null,
    },
  };
}
