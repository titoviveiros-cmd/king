// O MODO EFETIVO DO PROCESSO QUE SUBIU — lido do que ele mesmo declarou no boot.
//
// O deploy DECLARA um modo (o de /etc/king/server.env) e o processo REGISTRA, no boot, o modo em
// que realmente ficou (`[king] identity mode: …`, apps/server/src/index.ts). Este portão exige que
// os dois batam. É o que impede um rebaixamento silencioso — por exemplo, um código antigo que
// ignore o arquivo e suba em legacy com permanent declarado — de passar como deploy aprovado.
//
// USO (na VPS, depois do restart):
//   pm2 logs king-server --lines 400 --nostream | node scripts/conferir-modo-efetivo.mjs <legacy|permanent>
//
// Lê o log pela entrada padrão e considera o ÚLTIMO registro de modo (o do boot mais recente).
// Imprime só o modo; nenhuma outra linha do log sai daqui.
//
// SAÍDA: 0 confere · 1 diverge, ausente ou uso inválido.
const esperado = process.argv[2];
if (esperado !== "legacy" && esperado !== "permanent") {
  console.error("  xx uso: node scripts/conferir-modo-efetivo.mjs <legacy|permanent>  (log pela entrada padrão)");
  process.exit(1);
}
let texto = "";
for await (const pedaco of process.stdin) texto += pedaco;
const registros = [...texto.matchAll(/identity mode: (legacy|permanent)\b/g)];
if (registros.length === 0) {
  console.error("  xx nenhum registro de 'identity mode' no log — o processo no ar não declarou o modo em que subiu");
  process.exit(1);
}
const efetivo = registros.at(-1)[1];
if (efetivo !== esperado) {
  console.error(`  xx modo efetivo ${efetivo}, declarado ${esperado} — o processo no ar NÃO está no modo declarado`);
  process.exit(1);
}
console.log(`  ok modo efetivo do processo no ar: ${efetivo}`);
