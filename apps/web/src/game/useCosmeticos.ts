// OS COSMÉTICOS NA HOME (Entrega B) — lidos quando o progresso chega, e só então.
//
// Nada aqui segura a Home: a leitura corre ao lado, e falha = sem vitrine (`disponivel: false`), com
// o jogo exatamente como antes. O nível é o de `meu_progresso`, o MESMO que o banco usa para recusar.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProgressoDoJogador } from "../auth/progresso.js";
import {
  aplicarBaralho, guardarMesa, itemDaToalha, lembrarNivel, marcarCelebrados, paraCelebrar, toalhaEquipada,
  type CosmeticosDoJogador, type Equipados, type ItemDoCatalogo, type ItemId,
} from "../auth/cosmeticos.js";

export interface CosmeticosDaHome {
  /** A vitrine existe (sessão + tabela + leitura ok)? Sem ela, nenhum botão aparece. */
  disponivel: boolean;
  nivel: number;
  equipados: Equipados | null;
  /** Um pedido ao banco em andamento: os botões esperam. */
  ocupado: boolean;
  aviso: string | null;
  /** Itens recém-liberados, a celebrar AGORA. Vazio = nada a mostrar. */
  celebrar: ItemDoCatalogo[];
  equipar(item: ItemId, equipado: boolean): Promise<void>;
  dispensarCelebracao(): void;
}

const NIVEL_DO_BARALHO = 4;

/** O que vale NESTE aparelho contra os bots: o baralho e a mesa equipados, se o nível alcança. */
function aplicarNoAparelho(e: Equipados, nivel: number): void {
  aplicarBaralho(e["baralho-imperial"] && nivel >= NIVEL_DO_BARALHO);
  const t = toalhaEquipada(e);
  guardarMesa(nivel >= itemDaToalha(t).nivel ? t : "imperial");
}

export function useCosmeticos(api: CosmeticosDoJogador | null, progresso: ProgressoDoJogador | null): CosmeticosDaHome {
  const [equipados, setEquipados] = useState<Equipados | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [celebrar, setCelebrar] = useState<ItemDoCatalogo[]>([]);
  const nivel = progresso?.nivel ?? 1;
  const conta = progresso?.playerId ?? "conta";
  const vivo = useRef(true);
  useEffect(() => () => { vivo.current = false; }, []);

  useEffect(() => {
    if (!api || !progresso) { setEquipados(null); return; }
    lembrarNivel(progresso.nivel);
    let cancelado = false;
    void api.meus().then((e) => {
      if (cancelado) return;
      setEquipados(e);
      if (!e) return; // vitrine indisponível: o baralho guardado neste aparelho fica como estava
      aplicarNoAparelho(e, progresso.nivel);
      // UMA VEZ POR ITEM: marcado já ao aparecer. Reabrir a Home, reconectar ou fechar o app no
      // meio da celebração não a repete.
      const novos = paraCelebrar(progresso.nivel, progresso.playerId ?? "conta");
      if (novos.length > 0) {
        marcarCelebrados(progresso.playerId ?? "conta", novos.map((i) => i.id));
        setCelebrar(novos);
      }
    }, () => { if (!cancelado) setEquipados(null); });
    return () => { cancelado = true; };
  }, [api, progresso]);

  const equipar = useCallback(async (item: ItemId, sim: boolean) => {
    if (!api || ocupado) return;
    setOcupado(true);
    setAviso(null);
    const r = await api.equipar(item, sim, equipados ?? undefined);
    if (!vivo.current) return;
    setOcupado(false);
    if (r.ok) {
      setEquipados(r.equipados);
      aplicarNoAparelho(r.equipados, nivel);
      return;
    }
    setAviso(r.motivo === "nivel"
      ? "Este item ainda não foi liberado para a sua conta."
      : "Não foi possível salvar agora. Tente de novo em instantes.");
  }, [api, ocupado, equipados, nivel]);

  const dispensarCelebracao = useCallback(() => {
    marcarCelebrados(conta, celebrar.map((i) => i.id));
    setCelebrar([]);
  }, [conta, celebrar]);

  return {
    disponivel: equipados !== null, nivel, equipados, ocupado, aviso,
    celebrar: equipados !== null ? celebrar : [], equipar, dispensarCelebracao,
  };
}
