#!/usr/bin/env bash
# DEPLOY TRANSACIONAL DO SERVIDOR DO KING — para rodar NA VPS.
#
# ══ POR QUE ISTO É UM ARQUIVO, E NÃO UM BLOCO PARA COLAR ══
#
# As duas primeiras implantações foram feitas colando ~80 linhas no Web Terminal do hPanel, e nas
# duas a colagem se embaralhou: na primeira o `king_rollback` saiu com erro de sintaxe (a rede de
# segurança não estava armada, e só não fez falta porque nada falhou); na segunda o `king_deploy`
# foi truncado no meio e não chegou a existir. Um procedimento de implantação que depende de um
# terminal web não corromper um texto longo não é um procedimento: é uma aposta.
#
# Agora o texto viaja por onde texto viaja bem — o próprio repositório — e o que se cola é uma
# linha. Como ele roda em um `bash` próprio, `exit` encerra ESTE processo e nunca a sessão de
# quem executou; por isso aqui não há a disciplina de "só `return`" que o bloco colado exigia.
#
# USO (uma linha, no Web Terminal):
#
#   cd /opt/king && git fetch origin feat/multiplayer-v1 #     && git show origin/feat/multiplayer-v1:scripts/deploy-vps.sh > /tmp/king-deploy.sh #     && bash /tmp/king-deploy.sh <sha-curto>
#
# O script é buscado do REMOTO antes de a árvore de trabalho ser tocada: a versão que roda é a
# revisada no commit, não a que estiver no disco da VPS.
set -uo pipefail

ALVO="${1:-}"
BRANCH="feat/multiplayer-v1"
RAIZ="/opt/king"
APP="king-server"

if [ -z "$ALVO" ]; then
  echo "xx uso: bash /tmp/king-deploy.sh <sha-curto-alvo>"
  exit 2
fi

ANTERIOR=""
JA_REINICIOU=0

reiniciar() {
  pm2 restart "$APP" --update-env >/dev/null 2>&1 || return 1
  sleep 4
  pm2 describe "$APP" 2>/dev/null | grep -q "online" || return 1
  [ "$(curl -s -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:2567)" != "000" ] || return 1
  return 0
}

# Só erro GRAVE reprova. Recusas de protocolo (`AVATAR_TAKEN`, `WRONG_PHASE`…) são o servidor
# funcionando, e o próprio nome do arquivo de log do PM2 contém "error" — um portão que reprovasse
# por isso reverteria implantações boas, que é pior que não ter portão.
conferir_logs() {
  echo "=== LOGS POS-RESTART (ultimas 200 linhas) ==="
  local LOGS GRAVES SUSPEITAS
  LOGS=$(pm2 logs "$APP" --lines 200 --nostream 2>/dev/null)
  GRAVES=$(printf '%s
' "$LOGS" | grep -iE "unhandledpromiserejection|uncaught|EADDRINUSE|FATAL" | head -20)
  SUSPEITAS=$(printf '%s
' "$LOGS"     | grep -iE "error|exception|ECONNREFUSED"     | grep -viE "ACTION_REJECTED|AVATAR_TAKEN|AVATAR_PENDING|INVALID_PAYLOAD|WRONG_PHASE|MATCH_NOT_STARTED|error.log"     | head -20)
  if [ -n "$SUSPEITAS" ]; then
    echo "  ?? para leitura humana (nao reprova):"
    printf '     %s
' "$SUSPEITAS"
  fi
  if [ -n "$GRAVES" ]; then
    echo "  xx ERROS GRAVES:"
    printf '     %s
' "$GRAVES"
    return 1
  fi
  echo "  ok nenhum erro grave nos logs"
  return 0
}

reverter() {
  echo ""
  echo "!! ROLLBACK para ${ANTERIOR:0:7}"
  git reset --hard "$ANTERIOR" >/dev/null 2>&1 || { echo "   xx reset falhou - INTERVENCAO MANUAL"; return 1; }
  npm ci --silent >/dev/null 2>&1 && npm run build:server >/dev/null 2>&1     || { echo "   xx build do rollback falhou - INTERVENCAO MANUAL"; return 1; }
  if [ "$JA_REINICIOU" = "1" ]; then
    reiniciar || { echo "   xx o servidor NAO voltou - INTERVENCAO MANUAL"; return 1; }
    systemctl is-active --quiet nginx || echo "   !! nginx nao esta ativo"
    ufw status 2>/dev/null | grep -q "Status: active" || echo "   !! UFW nao esta ativo"
    echo "   ok versao anterior no ar, Nginx e UFW conferidos"
  else
    echo "   ok codigo anterior restaurado - o processo vivo nunca foi tocado"
  fi
  return 0
}

abortar() {
  echo "xx $1"
  reverter
  exit 1
}

echo ""
echo "DEPLOY DO KING — alvo $ALVO"
echo ""
echo "=== PRE-CONDICOES ==="
cd "$RAIZ" 2>/dev/null || { echo "xx $RAIZ nao existe"; exit 1; }
ATUAL=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
[ "$ATUAL" = "$BRANCH" ] || { echo "xx branch e '$ATUAL', esperado '$BRANCH'"; exit 1; }
echo "  ok branch $ATUAL"
git diff --quiet && git diff --cached --quiet || { echo "xx working tree sujo - PARE e investigue"; exit 1; }
echo "  ok working tree limpo"
pm2 describe "$APP" >/dev/null 2>&1 || { echo "xx '$APP' nao esta registrado no PM2"; exit 1; }
echo "  ok $APP registrado no PM2"
node -v | grep -qE '^v(2[2-9]|[3-9][0-9])' || { echo "xx Node $(node -v) - o projeto exige >= 22"; exit 1; }
echo "  ok Node $(node -v)"
ANTERIOR=$(git rev-parse HEAD)
echo "  ok ponto de retorno: ${ANTERIOR:0:7}"

echo "=== ATUALIZAR (fast-forward only) ==="
git fetch origin "$BRANCH" || { echo "xx fetch falhou - nada foi alterado"; exit 1; }
git merge --ff-only "origin/$BRANCH" || { echo "xx nao e fast-forward - PARE, nada foi alterado"; exit 1; }
NOVO=$(git rev-parse HEAD)
case "$NOVO" in
  "$ALVO"*) echo "  ok HEAD em ${NOVO:0:7}" ;;
  *) abortar "HEAD ${NOVO:0:7}, esperado $ALVO" ;;
esac

echo "=== CONSTRUIR - o processo vivo NAO e tocado ==="
npm ci || abortar "npm ci falhou"
npm run build:server || abortar "build falhou"
echo "  ok artefato compilado"

echo "=== O ARTEFATO CARREGA O QUE FOI APROVADO ==="
# Conferencia de ARTEFATO, e nao de comportamento. O portao bloqueante responde "o binario certo
# esta no ar"; "a mao 10 se comporta certo" e pergunta de outra natureza, ja respondida pela
# suite de servidor no CI e reconferida depois por `verificar-ultima-mao.mjs`, que roda FORA do
# caminho transacional. Um portao que exigisse jogar dez maos reais reverteria implantacoes boas
# por lentidao de rede, que e pior do que nao ter o portao.
conferir_artefato() {
  local ARQ="$1" PADRAO="$2" QUE="$3"
  [ -f "$ARQ" ] || { echo "  xx $ARQ nao existe"; return 1; }
  grep -qE "$PADRAO" "$ARQ" || { echo "  xx $QUE ausente em $ARQ"; return 1; }
  echo "  ok $QUE"
  return 0
}
ART=""
# `3_720` no fonte sobrevive a compilacao com o separador; o padrao aceita as duas grafias.
conferir_artefato "apps/server/dist/match/tempos.js" \
  "aberturaDaUltimaMao: 3_?720" "constante aberturaDaUltimaMao = 3720" || ART="$ART constante"
conferir_artefato "apps/server/dist/rooms/KingRoom.js" \
  "respiroDaAbertura" "respiro da abertura integrado a KingRoom" || ART="$ART integracao"
conferir_artefato "apps/server/dist/rooms/KingRoom.js" \
  "aberturaDaUltimaMao" "prazo da decisao consulta a constante" || ART="$ART consulta"
conferir_artefato "apps/server/dist/protocol/index.js" \
  "PROTOCOL_VERSION = 3" "PROTOCOL_VERSION = 3 no artefato" || ART="$ART protocolo"
[ -z "$ART" ] || abortar "artefato nao carrega a correcao aprovada:$ART"

echo "=== SMOKE EM PORTA SEPARADA (2599) ==="
SMOKE_PORT=2599 npm run smoke:server || abortar "o artefato novo nao sobe"

echo "=== REINICIAR ==="
JA_REINICIOU=1
reiniciar || abortar "o servidor nao voltou online"
echo "  ok $APP online e porta 2567 respondendo no loopback"

echo "=== PORTOES POS-RESTART ==="
FALHA=""
systemctl is-active --quiet nginx || FALHA="$FALHA nginx-inativo"
ufw status 2>/dev/null | grep -q "Status: active" || FALHA="$FALHA ufw-inativo"
ufw status 2>/dev/null | grep -E "^2567(/tcp)?[[:space:]]" | grep -qi "ALLOW" && FALHA="$FALHA porta-2567-exposta"
node scripts/verificar-implantacao.mjs ws://127.0.0.1:2567 || FALHA="$FALHA contrato-reprovado"
conferir_logs || FALHA="$FALHA logs-com-erro-grave"

if [ -n "$FALHA" ]; then
  echo "xx PORTOES REPROVADOS:$FALHA"
  reverter
  exit 1
fi

echo ""
echo "=== SHA IMPLANTADO, CONFERIDO DEPOIS DE TUDO ==="
# Repetido de proposito no fim. A conferencia anterior foi ANTES do build e do restart; esta
# responde "o que ficou no ar e o alvo", que e outra pergunta — entre as duas houve `npm ci`,
# compilacao e reinicio, e um portao de implantacao afirma sobre o estado final.
FINAL=$(git rev-parse HEAD)
case "$FINAL" in
  "$ALVO"*) echo "  ok commit implantado = ${FINAL:0:7}" ;;
  *) echo "xx commit implantado ${FINAL:0:7}, esperado $ALVO"; reverter; exit 1 ;;
esac

echo ""
echo "  ok Nginx . UFW . 2567 fechada . contrato aprovado . logs limpos . artefato conferido"
echo ""
echo "IMPLANTACAO CONCLUIDA - ${NOVO:0:7}"
echo ""
echo "PROXIMO PASSO (fora do caminho transacional, sem rollback automatico):"
echo "  cd $RAIZ && node scripts/verificar-ultima-mao.mjs ws://127.0.0.1:2567"
echo "retorno manual: cd $RAIZ && git reset --hard ${ANTERIOR:0:7} && npm ci && npm run build:server && pm2 restart $APP"
exit 0
