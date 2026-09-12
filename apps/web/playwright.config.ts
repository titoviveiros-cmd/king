import { defineConfig } from "@playwright/test";

/**
 * Playwright — testes de LAYOUT sobre o app real renderizado.
 *
 * Cada viewport é um PROJETO (parametrização, sem duplicar specs). Prioridade para os tamanhos
 * mobile landscape, que já revelaram ou poderiam revelar apertos de geometria (ver a tabela de
 * medições em docs/KING-DESIGN-SYSTEM.md). Servimos o BUILD de produção (`vite preview`) — assim
 * o CI valida o mesmo bundle que seria publicado.
 */

const CI = !!process.env.CI;

/**
 * Viewports críticos (nome = dimensão).
 *
 * DUAS FAMÍLIAS, e a segunda nasceu de um teste em iPhone real:
 *
 *   • LANDSCAPE NORMAL — a tela inteira do aparelho. É o que o simulador mostrava, e foi por
 *     isso que a suíte passava verde enquanto o jogo aparecia cortado na mão de uma pessoa.
 *   • ALTURA COMPACTA — a altura ÚTIL que sobra quando o navegador desenha a própria barra por
 *     cima. Num iPhone em paisagem o Safari come de 45 a 90 px, e é aí que a mão do jogador
 *     encostava no limite inferior.
 *
 * Emulação de viewport NÃO substitui aparelho físico. Ela cobre a geometria; o que ela não
 * cobre — barra do sistema, gesto de home, teclado virtual — continua exigindo QA real.
 */
const VIEWPORTS: Array<{ w: number; h: number }> = [
  // landscape normal
  { w: 667, h: 375 },
  { w: 740, h: 360 },
  { w: 780, h: 360 },
  { w: 800, h: 360 },
  { w: 844, h: 390 },
  { w: 852, h: 393 },
  { w: 874, h: 402 },
  { w: 956, h: 440 },
  { w: 1024, h: 768 },
  { w: 1600, h: 900 },
  // altura compacta — navegador com barra visível
  { w: 852, h: 330 },   // iPhone 14/15 Pro em paisagem, Safari com barra
  { w: 740, h: 320 },   // Android 20:9 com barra do Chrome
  { w: 852, h: 300 },   // stress: a menor altura útil que o KING promete atender
];

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  /**
   * O RELATOR HTML NÃO RODA EM CI — e a razão é que ele DERRUBAVA a CI com a suíte verde.
   *
   * Com 1612 testes em 13 viewports, o relator html termina de montar o relatório e estoura:
   * `RangeError: Invalid string length`. Ele monta o relatório inteiro como UMA string e passa
   * do limite do V8. O Playwright então sai com código 1 mesmo sem nenhum teste vermelho.
   *
   * Aconteceu em duas execuções seguidas, e nas duas ficou escondido: antes havia falhas reais
   * de teste, que já justificavam o vermelho. Quando a última falha foi corrigida, a CI fechou
   * assim — `1389 passed`, `223 skipped`, nenhuma falha, e vermelha:
   *
   *     223 skipped
   *     1389 passed (4.7h)
   *     RangeError: Invalid string length
   *     npm error code 1
   *
   * Em CI o diagnóstico continua existindo por `test-results/` — captura de tela na falha e
   * trace na primeira repetição —, que é o que se abre de fato quando algo quebra. O workflow já
   * sobe essa pasta, e o relatório html some sem quebrar o passo (`if-no-files-found: ignore`).
   *
   * Localmente o html continua ligado: é onde vale navegar 1600 testes, e a máquina de quem
   * roda tem memória para montá-lo.
   */
  reporter: CI ? [["list"]] : [["list"], ["html", { open: "never" }]],
  outputDir: "test-results",

  use: {
    baseURL: "http://localhost:4173",
    screenshot: "only-on-failure", // artefato de diagnóstico só quando falha
    trace: "on-first-retry",
    video: "off",
  },

  projects: VIEWPORTS.map(({ w, h }) => ({
    name: `${w}x${h}`,
    use: { browserName: "chromium", viewport: { width: w, height: h }, deviceScaleFactor: 1 },
  })),

  // Sobe o app buildado. Em CI o build roda antes (workflow); localmente, rode `npm run build`
  // no workspace antes do e2e. `reuseExistingServer` evita reinício quando já há um preview no ar.
  /**
   * DOIS servidores.
   *
   * O `preview` serve o bundle publicável — o mesmo que iria para a Vercel. O Colyseus entra
   * porque metade dos defeitos encontrados no iPhone real (o "ESTOU PRONTO" cortado no Lobby, o
   * botão social espremido na Mesa) só existe em tela de MULTIPLAYER, e sem servidor essas telas
   * eram inalcançáveis para o teste — ficavam cobertas só por medição manual, que foi exatamente
   * o que deixou os defeitos passarem.
   *
   * `VITE_KING_SERVER_URL` não é necessária: em `preview` o app não está em modo dev, então a
   * detecção automática não vale — por isso os testes de multiplayer apontam o cliente pela
   * própria URL do preview (ver tests/helpers/multiplayer.ts).
   */
  webServer: [
    {
      command: "npm run preview -- --port 4173 --strictPort",
      url: "http://localhost:4173",
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
    {
      command: "node ../../apps/server/dist/index.js",
      url: "http://127.0.0.1:2567",
      reuseExistingServer: !CI,
      timeout: 120_000,
      env: { PORT: "2567", NODE_ENV: "test" },
    },
  ],
});
