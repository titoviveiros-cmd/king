/**
 * O gameplay do KING é LANDSCAPE (13 cartas + 4 jogadores) — Design System.
 * Em retrato o aviso cobre a tela; a exibição é 100% CSS (`@media (orientation:portrait)`),
 * então não há re-render nem listener de orientação.
 */
export function RotateGate() {
  return (
    <div className="rotate" role="alertdialog" aria-label="Gire o aparelho">
      <div className="ico">📱</div>
      <h2>GIRE O APARELHO</h2>
      <p>O KING é jogado deitado — são 13 cartas e 4 jogadores na mesa.</p>
    </div>
  );
}
