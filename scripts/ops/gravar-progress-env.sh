#!/usr/bin/env bash
# GRAVAR O progress.env PENDENTE — na VPS, ANTES de ativar o progresso. Não reinicia nada.
#
# USO (como root, na VPS; a senha vem da área de transferência do computador que a gerou):
#   bash scripts/ops/gravar-progress-env.sh \
#     --ca /etc/king/supabase-ca-2021.crt --outbox /var/lib/king/progresso-outbox \
#     --host <host do Session pooler> --ref <ref do projeto> [--dono <usuario[:grupo]>] \
#     [--destino /etc/king/progress.env.pendente]
#
# O que ele garante:
#   - a senha NUNCA vem por argumento (qualquer argumento com cara de senha ou URL é recusado, sem
#     ser repetido na tela) — é lida sem eco, pela entrada;
#   - o arquivo nasce com umask 077 num temporário da MESMA pasta, recebe fsync, e só então é
#     renomeado para o destino (rename atômico); a pasta também recebe fsync;
#   - o progress.env ATIVO nunca é o destino, e um pendente que já exista nunca é sobrescrito;
#   - o caminho da CA é confirmado digitando-o de novo; o outbox é obrigatório;
#   - a saída mostra host e ref (não são segredo), nunca a senha nem a URL montada.
#
# Depois: node scripts/progresso-sonda.mjs <destino>   (como o usuário do PM2)
set -euo pipefail

uso() {
  echo "uso: bash scripts/ops/gravar-progress-env.sh --ca <arquivo> --outbox <pasta> --host <host> --ref <ref> [--dono <usuario[:grupo]>] [--destino <arquivo>]" >&2
  exit 64
}
falhar() { echo "xx $* (nada foi gravado)" >&2; exit 1; }

# Nenhum argumento pode carregar senha ou URL. O valor recusado NÃO é repetido.
for a in "$@"; do
  case "$a" in
    *senha*|*SENHA*|*password*|*PASSWORD*|*passwd*|*postgres://*|*postgresql://*|*@*)
      falhar "senha e URL nunca entram por argumento — a senha é pedida depois, sem eco" ;;
  esac
done

CA="" OUTBOX="" HOST="" REF="" DONO="" DESTINO="/etc/king/progress.env.pendente"
while [ $# -gt 0 ]; do
  [ $# -ge 2 ] || uso
  case "$1" in
    --ca) CA="$2" ;;
    --outbox) OUTBOX="$2" ;;
    --host) HOST="$2" ;;
    --ref) REF="$2" ;;
    --dono) DONO="$2" ;;
    --destino) DESTINO="$2" ;;
    *) falhar "argumento não reconhecido" ;;
  esac
  shift 2
done
[ -n "$CA" ] && [ -n "$OUTBOX" ] && [ -n "$HOST" ] && [ -n "$REF" ] || uso

[[ "$REF" =~ ^[a-z0-9]{20}$ ]] || falhar "--ref precisa ser o ref do projeto (20 letras minúsculas e dígitos)"
[[ "$HOST" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || falhar "--host precisa ser só o nome do host do pooler"
case "$CA" in /*) ;; *) falhar "--ca precisa ser caminho absoluto" ;; esac
case "$OUTBOX" in /*) ;; *) falhar "--outbox precisa ser caminho absoluto" ;; esac
case "$DESTINO" in /*) ;; *) falhar "--destino precisa ser caminho absoluto" ;; esac
[ "$(basename "$DESTINO")" != "progress.env" ] || falhar "o destino é o progress.env ATIVO — este script só grava o pendente"
[ ! -e "$DESTINO" ] || falhar "$DESTINO já existe — apague ou renomeie antes"
DIR="$(dirname "$DESTINO")"
[ -d "$DIR" ] || falhar "a pasta $DIR não existe"
{ [ -f "$CA" ] && grep -q -- "-----BEGIN CERTIFICATE-----" "$CA"; } || falhar "--ca não é um certificado PEM legível"

# ── confirmação explícita da CA ──
echo "CA: $CA" >&2
echo "    $(openssl x509 -in "$CA" -noout -fingerprint -sha256 2>/dev/null || echo 'impressão digital indisponível: confira com node scripts/ops/conferir-ca.mjs')" >&2
read -r -p "Para confirmar, digite de novo o caminho COMPLETO da CA: " CONFIRMA || falhar "confirmação da CA não recebida"
[ "$CONFIRMA" = "$CA" ] || falhar "o caminho digitado não confere com --ca"

# ── a senha: sem eco, sem argumento, sem histórico ──
read -rs -p "Cole a senha do king_server (não aparece): " SENHA || falhar "senha não recebida"
echo >&2
if [[ ! "$SENHA" =~ ^[A-Za-z0-9_-]{43}$ ]]; then
  SENHA=""
  falhar "a senha não tem o formato da ferramenta de credencial (43 caracteres base64url)"
fi

# ── temporário na MESMA pasta → fsync → rename atômico → fsync da pasta ──
umask 077
TMP="$(mktemp "$DIR/.progress.env.XXXXXX")"
trap 'rm -f "$TMP"' EXIT
{
  printf 'KING_PROGRESS_MODE=database\n'
  printf 'KING_PROGRESS_DATABASE_URL=postgresql://king_server.%s:%s@%s:5432/postgres\n' "$REF" "$SENHA" "$HOST"
  printf 'KING_PROGRESS_SSL_ROOT_CERT=%s\n' "$CA"
  printf 'KING_PROGRESS_OUTBOX_DIR=%s\n' "$OUTBOX"
} > "$TMP"
SENHA=""
unset SENHA
if [ -n "$DONO" ]; then chown "$DONO" "$TMP" || falhar "chown para $DONO falhou"; fi
chmod 600 "$TMP"
sync "$TMP"
mv -f "$TMP" "$DESTINO"
trap - EXIT
sync "$DIR"

echo "ok gravado: $DESTINO (modo 600${DONO:+, dono $DONO}) · host: $HOST · ref: $REF · senha: não exibida"
echo "   próximo passo: node scripts/progresso-sonda.mjs $DESTINO"
