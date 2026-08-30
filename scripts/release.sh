#!/usr/bin/env bash
#
# =============================================================================
# release.sh — Processo de release local do IAsConta
# =============================================================================
#
# Espelha o workflow .github/workflows/release.yml:
#   1. Descobre a última tag semver (ou usa v0.0.0 como base);
#   2. Calcula a próxima versão pelos Conventional Commits entre as tags:
#        - feat! / BREAKING CHANGE  -> major  (v2.0.0)
#        - feat                      -> minor  (v1.1.0)
#        - fix/perf/docs/demais      -> patch  (v1.0.1)
#      Sem mudanças -> aborta;
#   3. Gera/atualiza o CHANGELOG.md na raiz do repositório, agrupado por
#      categoria (🚀 Features, 🐛 Fixes, ⚙️ Manutenção) com links para
#      commits e PRs;
#   4. Cria a tag anotada vX.Y.Z no HEAD atual e envia para o remoto;
#   5. Publica a Release no GitHub via gh (gh release create).
#
# Uso:
#   ./scripts/release.sh [--tipo=auto|patch|minor|major] [--dry-run] [--help]
#
# Opções:
#   --tipo=<valor>  Força o tipo de bump (padrão: auto).
#   --dry-run       Apenas calcula a versão e mostra o changelog no terminal,
#                   sem criar tag, enviar nada ou alterar arquivos.
#   --help | -h     Mostra esta ajuda e sai.
#
# Pré-requisitos:
#   - gh autenticado (gh auth status) com escopo 'repo';
#   - remote 'origin' com permissão de push (o URL já carrega o token);
#   - working tree limpo (exceto em --dry-run);
#   - estar em master atualizada (git pull) antes de lançar.
#
# Exemplos:
#   ./scripts/release.sh                     # bump automático e publica
#   ./scripts/release.sh --tipo=major        # força v2.0.0 (primeira release)
#   ./scripts/release.sh --dry-run           # pré-visualiza sem criar nada
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_DIR}"

TIPO="auto"
DRY_RUN=0

# -----------------------------------------------------------------------------
# Ajuda
# -----------------------------------------------------------------------------
mostrar_ajuda() {
  awk 'NR > 1 && /^#/ { gsub(/^# ?/, ""); print; next } /^set -euo/ { exit }' "${BASH_SOURCE[0]}"
}

# -----------------------------------------------------------------------------
# Última tag semver do repositório (ou v0.0.0 quando não há tags)
# -----------------------------------------------------------------------------
obter_ultima_tag() {
  local tag
  tag="$(git tag --sort=-v:refname | head -1 || true)"
  echo "${tag:-v0.0.0}"
}

# -----------------------------------------------------------------------------
# bump semver: vX.Y.Z + patch|minor|major -> nova versão
# -----------------------------------------------------------------------------
bump_semver() {
  local v="${1#v}" tipo="$2" M m p
  IFS='.' read -r M m p <<< "${v}"
  case "${tipo}" in
    major) M=$((M + 1)); m=0; p=0 ;;
    minor) m=$((m + 1)); p=0 ;;
    patch) p=$((p + 1)) ;;
  esac
  echo "v${M}.${m}.${p}"
}

# -----------------------------------------------------------------------------
# Classifica os commits do range e preenche CHG_MAJOR/CHG_FEAT/CHG_PATCH
# (deve ser chamada NO shell atual — não em $( ) — para os globals valerem)
# -----------------------------------------------------------------------------
classificar_commits() {
  local range="$1" SUBJ
  CHG_MAJOR=0; CHG_FEAT=0; CHG_PATCH=0
  while IFS=$'\t' read -r _ SUBJ; do
    case "${SUBJ}" in
      [Mm]erge*) continue ;;
    esac
    case "${SUBJ}" in
      feat!:* | feature!:*) CHG_MAJOR=1; CHG_FEAT=1 ;;
      *!:* | BREAKING*)     CHG_MAJOR=1 ;;
      feat:* | feature:*)   CHG_FEAT=1 ;;
      *)                    CHG_PATCH=1 ;;
    esac
  done < <(git log --format='%h%x09%s' "${range}" 2>/dev/null || true)
}

# -----------------------------------------------------------------------------
# Gera a seção do changelog (imprime em stdout)
# Uso: gerar_changelog <range> <owner/repo>
#   range = 'X.Y.Z..HEAD' ou 'HEAD' (quando ainda não há tags)
# -----------------------------------------------------------------------------
gerar_changelog() {
  local range="$1" repo="$2"
  local HASTA=0
  local FEATURES="" FIXES="" MANUT=""
  local SHA SUBJ SUBJ_LINK LINHA GRUPO

  while IFS=$'\t' read -r SHA SUBJ; do
    case "${SUBJ}" in
      [Mm]erge*) continue ;;
    esac
    HASTA=1
    SUBJ_LINK="$(printf '%s' "${SUBJ}" | sed -E "s|\(#([0-9]+)\)|([#\1](https://github.com/${repo}/pull/\1))|g")"
    LINHA="- ${SUBJ_LINK} ([${SHA}](https://github.com/${repo}/commit/${SHA}))"
    case "${SUBJ}" in
      feat!:* | feature!:*) GRUPO="features" ;;
      *!:* | BREAKING*)     GRUPO="features" ;;
      feat:* | feature:*)   GRUPO="features" ;;
      fix:*)                GRUPO="fixes" ;;
      *)                    GRUPO="manut" ;;
    esac
    case "${GRUPO}" in
      features) FEATURES="${FEATURES}${LINHA}"$'\n' ;;
      fixes)    FIXES="${FIXES}${LINHA}"$'\n' ;;
      manut)    MANUT="${MANUT}${LINHA}"$'\n' ;;
    esac
  done < <(git log --format='%h%x09%s' "${range}" 2>/dev/null || true)

  if [ "${HASTA}" = "0" ]; then
    echo "Nenhuma mudança desde a última tag. Nada para lançar." >&2
    exit 2
  fi

  {
    if [ -n "${FEATURES}" ]; then
      echo "### 🚀 Features"
      echo ""
      printf '%s' "${FEATURES}"
      echo ""
    fi
    if [ -n "${FIXES}" ]; then
      echo "### 🐛 Fixes"
      echo ""
      printf '%s' "${FIXES}"
      echo ""
    fi
    if [ -n "${MANUT}" ]; then
      echo "### ⚙️ Manutenção"
      echo ""
      printf '%s' "${MANUT}"
      echo ""
    fi
  }
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
for arg in "$@"; do
  case "${arg}" in
    --help | -h) mostrar_ajuda; exit 0 ;;
    --dry-run)   DRY_RUN=1 ;;
    --tipo=*)    TIPO="${arg#*=}" ;;
    *) echo "Opção desconhecida: ${arg}" >&2; mostrar_ajuda; exit 1 ;;
  esac
done

case "${TIPO}" in
  auto | patch | minor | major) ;;
  *) echo "Erro: tipo inválido '${TIPO}' (use auto, patch, minor ou major)." >&2; exit 1 ;;
esac

command -v gh >/dev/null 2>&1 || { echo "Erro: gh (GitHub CLI) não encontrado." >&2; exit 1; }
if ! gh auth status >/dev/null 2>&1; then
  echo "Erro: gh não autenticado. Execute 'gh auth login' primeiro." >&2
  exit 1
fi

REMOTE_URL="$(git remote get-url origin 2>/dev/null || true)"
if [ -z "${REMOTE_URL}" ]; then
  echo "Erro: remote 'origin' não configurado." >&2
  exit 1
fi
REPO="$(printf '%s' "${REMOTE_URL}" | sed -E 's|.*github\.com[:/]||; s|\.git$||')"

ULTIMA_TAG="$(obter_ultima_tag)"
if git rev-parse -q --verify "refs/tags/${ULTIMA_TAG}" >/dev/null 2>&1; then
  RANGE="${ULTIMA_TAG}..HEAD"
else
  RANGE="HEAD"
fi

if [ "${DRY_RUN}" = "0" ]; then
  if [ -n "$(git status --porcelain)" ]; then
    echo "Erro: working tree sujo. Commite ou faça stash antes de lançar (ou use --dry-run)." >&2
    exit 1
  fi
  if [ "$(git branch --show-current)" != "master" ]; then
    echo "Atenção: você está em '$(git branch --show-current)', não em master. Pode continuar, mas a release apontará para o HEAD atual." >&2
  fi
  if git rev-parse -q --verify "refs/tags/$(bump_semver "${ULTIMA_TAG}" "${TIPO}")" >/dev/null 2>&1; then
    echo "Erro: a tag $(bump_semver "${ULTIMA_TAG}" "${TIPO}") já existe localmente." >&2
    exit 1
  fi
fi

# Gera o changelog e classifica os commits (no shell atual)
classificar_commits "${RANGE}"
CORPO="$(gerar_changelog "${RANGE}" "${REPO}")"

# Decide o bump
if [ "${TIPO}" = "auto" ]; then
  if [ "${CHG_MAJOR}" = "1" ] || printf '%s' "$(git log --format='%B' "${RANGE}")" | grep -qi 'breaking change'; then
    TIPO_BUMP="major"
  elif [ "${CHG_FEAT}" = "1" ]; then
    TIPO_BUMP="minor"
  else
    TIPO_BUMP="patch"
  fi
  if [ "${CHG_MAJOR}" = "0" ] && [ "${CHG_FEAT}" = "0" ] && [ "${CHG_PATCH}" = "0" ]; then
    echo "Nenhuma mudança no padrão Conventional Commits desde ${ULTIMA_TAG}. Nada para lançar." >&2
    exit 2
  fi
else
  TIPO_BUMP="${TIPO}"
fi

VERSAO="$(bump_semver "${ULTIMA_TAG}" "${TIPO_BUMP}")"

if [ "${ULTIMA_TAG}" != "v0.0.0" ] && git rev-parse -q --verify "refs/tags/${ULTIMA_TAG}" >/dev/null 2>&1; then
  CABECALHO="## [${VERSAO}](https://github.com/${REPO}/compare/${ULTIMA_TAG}...${VERSAO}) ($(date +%Y-%m-%d))"
else
  CABECALHO="## ${VERSAO} ($(date +%Y-%m-%d))"
fi

SECAO="# Changelog

${CABECALHO}

${CORPO}"

echo "================================================================"
echo " Repositório : ${REPO}"
echo " Última tag  : ${ULTIMA_TAG}"
echo " Bump        : ${TIPO_BUMP} (modo: ${TIPO})"
echo " Nova versão : ${VERSAO}"
echo "================================================================"
echo ""
printf '%s\n' "${SECAO}"

if [ "${DRY_RUN}" = "1" ]; then
  echo ""
  echo ">>> --dry-run: nada foi criado. Remova o flag para publicar de verdade."
  exit 0
fi

# 1) CHANGELOG.md (prepende a nova seção)
if [ -f CHANGELOG.md ]; then
  ANTIGO="$(cat CHANGELOG.md)"
  ANTIGO="$(printf '%s\n' "${ANTIGO}" | sed '1{/^# Changelog/d}')"
  printf '%s\n\n%s\n' "${SECAO}" "${ANTIGO}" > CHANGELOG.md
else
  printf '%s\n' "${SECAO}" > CHANGELOG.md
fi
echo ">>> CHANGELOG.md atualizado."

# 2) Tag anotada + push
if git ls-remote --tags origin "${VERSAO}" | grep -q .; then
  echo "Erro: a tag ${VERSAO} já existe no remoto." >&2
  exit 1
fi
git tag -a "${VERSAO}" -m "Release ${VERSAO}"
git push origin "${VERSAO}"
echo ">>> Tag ${VERSAO} criada e enviada."

# 3) Release no GitHub
NOTAS="$(mktemp)"
printf '%s\n' "${SECAO}" > "${NOTAS}"
gh release create "${VERSAO}" --title "${VERSAO}" --notes-file "${NOTAS}"
rm -f "${NOTAS}"

echo ""
echo ">>> Release ${VERSAO} publicada com sucesso!"