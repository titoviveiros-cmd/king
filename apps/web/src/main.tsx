import ReactDOM from "react-dom/client";
import "@fontsource/gabarito/700.css";
import "@fontsource/gabarito/800.css";
import "@fontsource/nunito/400.css";
import "@fontsource/nunito/700.css";
import "./ui/theme.css";
import { App } from "./App.js";

// Sem StrictMode: o loop de bots usa um setInterval; o double-invoke do StrictMode em dev
// poderia duplicar passos. Em produção não faria diferença, mas mantemos previsível.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
