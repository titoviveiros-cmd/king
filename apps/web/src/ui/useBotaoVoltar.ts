import { useEffect, useRef } from "react";

/**
 * Botão VOLTAR do Android: sai da mesa para a tela anterior em vez de abandonar a página.
 *
 * O efeito depende SÓ de `naMesa`, e nunca da identidade da função de saída.
 *
 * Isso não é preciosismo: a limpeza deste efeito chama `history.back()` para desfazer a entrada
 * que empurramos. Se o efeito reexecutasse a cada render — o que acontece quando quem chama passa
 * uma arrow function nova toda vez —, o `back()` da limpeza dispararia um `popstate` que o
 * listener recém-registrado interpretaria como "o usuário apertou VOLTAR", e a Mesa se fecharia
 * sozinha. Foi exatamente o que aconteceu no multiplayer: a partida começava e a tela voltava
 * para a Home no mesmo instante. Guardar a função numa ref elimina a classe inteira do defeito.
 */
export function useBotaoVoltar(naMesa: boolean, sair: () => void): void {
  const acao = useRef(sair);
  acao.current = sair;

  useEffect(() => {
    if (!naMesa) return;
    window.history.pushState({ king: "mesa" }, "");
    const onPop = () => acao.current();
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // saiu pelo botão "Sair": desfaz a entrada que empurramos, para não sobrar histórico
      if ((window.history.state as { king?: string } | null)?.king === "mesa") window.history.back();
    };
  }, [naMesa]);
}
