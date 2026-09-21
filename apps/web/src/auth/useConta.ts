// A CONTA VISTA PELA TELA — três estados e um verbo.
//
// O componente não conhece Supabase, não conhece token e não conhece PKCE. Ele sabe se há uma
// conta vinculada, se algo está em curso, e como pedir o vínculo. Toda a mecânica mora em
// `conta.ts`, e é lá que ela é testada sem navegador.
//
// O retorno do Google é processado UMA vez, na montagem, ANTES de o estado ser lido: quem volta
// do provedor precisa ver a Home já com o desfecho, e a URL precisa sair limpa antes de qualquer
// coisa gravar histórico.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ContaDoJogador, MotivoDaFalha } from "./conta.js";
import { contaConfigurada } from "./identidade.js";

export type EstadoVisivelDaConta = "guest" | "google" | "processando" | "erro";

export interface ContaDaHome {
  estado: EstadoVisivelDaConta;
  /** Frase neutra para a tela, ou `null`. Nunca carrega detalhe técnico nem identificador. */
  aviso: string | null;
  onVincular: () => void;
}

/**
 * FRASES NEUTRAS, DE PROPÓSITO.
 *
 * O jogador não precisa saber se faltou verificador PKCE ou se o usuário voltou trocado — precisa
 * saber que não deu certo e que o jogo continua dele. O motivo técnico vive no tipo, é conferido
 * em teste, e não vai para a tela.
 */
const AVISOS: Record<MotivoDaFalha, string> = {
  indisponivel: "Conectar com o Google não está disponível agora.",
  "sem-sessao": "Entre numa sala uma vez antes de conectar o Google.",
  "sem-transacao": "Não foi possível concluir. Tente conectar de novo.",
  "callback-invalido": "Não foi possível concluir. Tente conectar de novo.",
  "troca-de-usuario": "A conta que voltou do Google não é a mesma. Nada foi alterado.",
  "nao-vinculado": "O Google não ficou conectado. Tente de novo.",
  "provedor-recusou": "O Google não concluiu a conexão. Tente de novo.",
};

export function useConta(): ContaDaHome | null {
  const conta = useRef<ContaDoJogador | null>(null);
  if (conta.current === null) conta.current = contaConfigurada();
  const disponivel = conta.current !== null;

  const [estado, setEstado] = useState<EstadoVisivelDaConta>("processando");
  const [aviso, setAviso] = useState<string | null>(null);
  const jaProcessou = useRef(false);

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

  const onVincular = useCallback(() => {
    const c = conta.current;
    if (!c) return;
    setAviso(null);
    setEstado("processando");
    void (async () => {
      const r = await c.vincularGoogle();
      if (r.ok && r.jaVinculado) { setEstado("google"); return; }
      if (r.ok) return; // o navegador está saindo para o Google; a tela não muda mais
      setAviso(AVISOS[r.motivo]);
      setEstado("guest");
    })();
  }, []);

  if (!disponivel) return null;
  return { estado, aviso, onVincular };
}
