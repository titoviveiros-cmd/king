export function Home({ onStart }: { onStart: () => void }) {
  return (
    <div className="home">
      <div className="kw">KING</div>
      <div className="tg">Fuja do <b>King</b>. Domine a mesa.</div>
      <button className="btn gold" onClick={onStart}>▶ Jogar agora</button>
      <div className="foot">1 jogador + 3 bots · 4 jogadores · 10 mãos · base jogável (motor real)</div>
    </div>
  );
}
