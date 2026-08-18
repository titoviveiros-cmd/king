import { useState } from "react";
import {
  makeDeck, shuffle, deal, createRng, cardId,
  type Card as CardType,
} from "@king/engine";
import { Card } from "./components/Card.js";

interface Table {
  hand: CardType[];
  opponent: CardType[];
  up: CardType;
}

function newTable(): Table {
  // Semente aleatória por partida; o embaralhamento em si é determinístico por semente.
  const rng = createRng(Math.floor(Math.random() * 2 ** 31));
  const deck = shuffle(makeDeck(), rng);
  const { hands, draw } = deal(deck, 2, 7);
  return { hand: hands[0], opponent: hands[1], up: draw[0] };
}

export function App() {
  const [table, setTable] = useState<Table>(newTable);

  return (
    <div className="app">
      <header>
        <h1>🃏 Jogo de Cartas</h1>
        <p>Fundação jogável — o motor distribui as cartas. Regras entram a seguir.</p>
      </header>

      <main className="table-felt">
        <section className="row opponent" aria-label="Mão do oponente">
          {table.opponent.map((c) => (
            <Card key={cardId(c)} faceDown />
          ))}
        </section>

        <section className="row pile" aria-label="Mesa">
          <Card faceDown />
          <Card card={table.up} />
        </section>

        <section className="hand" aria-label="Sua mão">
          {table.hand.map((c, i) => {
            const mid = (table.hand.length - 1) / 2;
            const angle = (i - mid) * 6;
            const x = (i - mid) * 46;
            const y = Math.abs(i - mid) * 6;
            return (
              <Card
                key={cardId(c)}
                card={c}
                style={{
                  position: "absolute",
                  left: "calc(50% - var(--card-w) / 2)",
                  transform: `translate(${x}px, ${-y}px) rotate(${angle}deg)`,
                  zIndex: i,
                }}
                onClick={() => console.log("clicou", cardId(c))}
              />
            );
          })}
        </section>
      </main>

      <div className="controls">
        <button onClick={() => setTable(newTable())}>Embaralhar e distribuir</button>
      </div>
    </div>
  );
}
