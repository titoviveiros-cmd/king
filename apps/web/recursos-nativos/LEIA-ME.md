# Recursos nativos do KING

- `arte/king-icone-aprovado-512.png` — o ícone **aprovado pelo titular** (KING branco sobre feltro
  verde). É a única fonte. O hash dele está fixado em `scripts/gerar-recursos-android.mjs`; trocar a
  arte (por exemplo, pela "v2 de sangria total", ainda pendente) exige aprovação e a troca do hash.
- `res-android/` — ícone adaptativo, legado, redondo e splash, já nos tamanhos do Android. O splash
  do Android 7–11 é a `layer-list` `drawable/king_splash.xml` (cor do app + emblema de 128 dp
  centralizado), que não estica em tela nenhuma; o Android 12+ usa o splash do sistema. **Gerado**:
  `node scripts/gerar-recursos-android.mjs`. Copiado para `apps/web/android/` pelo `npm run mobile:preparar`
  (que roda dentro do `mobile:sync`) e conferido byte a byte pelo `npm run mobile:validar`.
- `play-store/king-icone-play-512.png` — a arte aprovada com os cantos transparentes (a original tem
  cantos pretos opacos, que a máscara de 20% da Play deixaria aparecer). Candidato para a ficha da loja.

A única intervenção na arte é essa: os cantos fora do arredondado do emblema. Os pixels de dentro não mudam.
