import ReactDOM from "react-dom/client";
import "@fontsource/gabarito/700.css";
import "@fontsource/gabarito/800.css";
import "@fontsource/nunito/400.css";
import "@fontsource/nunito/700.css";
import "./ui/theme.css";
import { App } from "./App.js";

/**
 * Altura REALMENTE visível, em `--vh` (1% dela).
 * `vh` mede a viewport de layout e `dvh` nem sempre acompanha a barra flutuante do Safari em
 * paisagem nem a barra do Chrome no Android — o resultado era o leque cortado na base.
 * `visualViewport` é a única medida que corresponde ao que o jogador enxerga.
 */
function trackViewportHeight(): void {
  const vv = window.visualViewport;
  const apply = () => {
    const h = vv?.height || window.innerHeight;
    // Antes do primeiro layout a altura pode vir 0 — nesse caso não escrevemos nada e o CSS
    // segue com o seu próprio `1dvh`/`1vh`. Um `--vh: 0px` encolheria a mesa inteira.
    if (!(h > 0)) return;
    document.documentElement.style.setProperty("--vh", `${h / 100}px`);
  };
  apply();
  requestAnimationFrame(apply);
  window.addEventListener("load", apply);
  vv?.addEventListener("resize", apply);
  vv?.addEventListener("scroll", apply);
  window.addEventListener("resize", apply);
  window.addEventListener("orientationchange", () => setTimeout(apply, 250));
}
trackViewportHeight();

// Sem StrictMode: o loop de bots usa um setInterval; o double-invoke do StrictMode em dev
// poderia duplicar passos. Em produção não faria diferença, mas mantemos previsível.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
