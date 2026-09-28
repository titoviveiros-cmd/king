// O PROGRESSO DO JOGADOR NA HOME — lido quando a Home aparece, e só então.
//
// Falha, sessão ausente ou banco lento: `null`, e a Home é a de sempre. Nada aqui segura a Home
// nem os botões de jogar — a leitura corre ao lado, e a resposta que chegar depois de a Home sair
// de cena é descartada.
import { useEffect, useState } from "react";
import type { LeitorDeProgresso, ProgressoDoJogador } from "../auth/progresso.js";

export function useMeuProgresso(leitor: LeitorDeProgresso | null, ativo: boolean): ProgressoDoJogador | null {
  const [progresso, setProgresso] = useState<ProgressoDoJogador | null>(null);
  useEffect(() => {
    if (!ativo || !leitor) return;
    let cancelado = false;
    void leitor.meuProgresso().then((p) => { if (!cancelado) setProgresso(p); }, () => { if (!cancelado) setProgresso(null); });
    return () => { cancelado = true; };
  }, [leitor, ativo]);
  return ativo ? progresso : null;
}
