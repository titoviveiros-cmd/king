import ReactDOM from "react-dom/client";
import "@fontsource/gabarito/700.css";
import "@fontsource/gabarito/800.css";
import "@fontsource/nunito/400.css";
import "@fontsource/nunito/700.css";
import "./ui/theme.css";
import { App } from "./App.js";

/**
 * A altura visível vem do CSS: `--vh` é `1dvh` onde existe e `1vh` como reserva (ver theme.css).
 *
 * Houve aqui uma versão que escrevia `--vh` por JS a partir de `visualViewport`. Foi removida:
 * dependia de eventos de resize que nem sempre chegam, e quando não chegavam o valor **congelava**
 * — a mesa continuava dimensionada para uma tela anterior. `dvh` acompanha a barra flutuante do
 * Safari e a barra do Chrome sozinho, sem evento nenhum. O corte do leque na base, que motivou
 * aquela versão, tinha outra causa (a barriga do arco) e foi resolvido em `--ymax`.
 */

// Sem StrictMode: o loop de bots usa um setInterval; o double-invoke do StrictMode em dev
// poderia duplicar passos. Em produção não faria diferença, mas mantemos previsível.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
