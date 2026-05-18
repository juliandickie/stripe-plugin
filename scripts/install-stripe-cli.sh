#!/usr/bin/env bash
# Provision the official Stripe CLI into CLAUDE_PLUGIN_DATA, pinned and
# checksum-verified. Idempotent: no-op if the pinned binary already exists.
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(tr -d ' \n' < "${PLUGIN_ROOT}/scripts/stripe-cli-version.txt")"
if ! printf '%s' "${VERSION}" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "Invalid version in scripts/stripe-cli-version.txt: '${VERSION}'" >&2
  exit 1
fi
DATA_DIR="${CLAUDE_PLUGIN_DATA:-${HOME}/.claude/plugins/data/stripe}"
DEST="${DATA_DIR}/stripe-cli/${VERSION}"
BIN="${DEST}/stripe"

if [ -x "${BIN}" ]; then
  echo "stripe-cli ${VERSION} already provisioned at ${BIN}"
  exit 0
fi

uname_s="$(uname -s)"
uname_m="$(uname -m)"
case "${uname_s}" in
  Darwin) os="mac-os" ;;
  Linux)  os="linux" ;;
  *) echo "Unsupported OS ${uname_s} for Stripe CLI auto-provision. Install manually and set PATH." >&2; exit 1 ;;
esac
case "${uname_m}" in
  x86_64|amd64) arch="x86_64" ;;
  arm64|aarch64) arch="arm64" ;;
  *) echo "Unsupported arch ${uname_m}." >&2; exit 1 ;;
esac

base="https://github.com/stripe/stripe-cli/releases/download/v${VERSION}"
tarball="stripe_${VERSION}_${os}_${arch}.tar.gz"
tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT

echo "Downloading ${tarball}"
curl -fL --silent --show-error "${base}/${tarball}" -o "${tmp}/${tarball}"
curl -fL --silent --show-error "${base}/stripe_${VERSION}_checksums.txt" -o "${tmp}/checksums.txt"

# checksums.txt format is "<sha256>  <file>" (two spaces); the single leading
# space here matches the second of those two and anchors on the exact filename.
( cd "${tmp}" && grep " ${tarball}\$" checksums.txt | shasum -a 256 -c - )

mkdir -p "${DEST}"
tar -xzf "${tmp}/${tarball}" -C "${DEST}" stripe
chmod +x "${BIN}"
echo "Provisioned stripe-cli ${VERSION} at ${BIN}"
