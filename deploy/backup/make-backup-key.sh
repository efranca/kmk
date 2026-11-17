#!/usr/bin/env bash
# Key ceremony: create the key pair that protects the backups. RUN IT YOURSELF in a normal terminal window.
#   make-backup-key.sh --private-out FILE [--public-out FILE] [--replace-public]
# The private key is written to FILE (mode 600) and must then be stored in your password manager together with the
# passphrase you choose, and FILE deleted. Only the public key stays on this machine (default
# ~/.config/kmk-backup/recipient.pub.asc). Whoever has the private key and passphrase can read every backup;
# without them the backups cannot be restored.
set -euo pipefail

PRIVATE_OUT=""; PUBLIC_OUT="${HOME}/.config/kmk-backup/recipient.pub.asc"; REPLACE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --private-out) PRIVATE_OUT="${2:?--private-out needs a file}"; shift 2 ;;
    --public-out) PUBLIC_OUT="${2:?--public-out needs a file}"; shift 2 ;;
    --replace-public) REPLACE=1; shift ;;
    -h|--help) sed -n '2,8p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$PRIVATE_OUT" ]] || { echo "usage: make-backup-key.sh --private-out FILE [--public-out FILE] [--replace-public]" >&2; exit 2; }
if [[ -e "$PRIVATE_OUT" ]]; then echo "ERROR: $PRIVATE_OUT already exists; not overwriting it." >&2; exit 1; fi
if [[ -e "$PUBLIC_OUT" && "$REPLACE" != 1 ]]; then
  echo "ERROR: $PUBLIC_OUT already exists. Replacing the recipient key would make earlier backups unreadable with the new key; use --replace-public only if you mean it." >&2
  exit 1
fi

TMP_BASE="${KMK_BACKUP_TMP:-${XDG_RUNTIME_DIR:-/dev/shm}}"
mkdir -p "$TMP_BASE"
KEYRING="$(mktemp -d -p "$TMP_BASE" kmk-keygen.XXXXXX)"; chmod 700 "$KEYRING"
cleanup() {
  GNUPGHOME="$KEYRING" gpgconf --kill all >/dev/null 2>&1 || true
  rm -rf "$KEYRING"
}
trap cleanup EXIT
export GNUPGHOME="$KEYRING"
if [[ -t 0 ]]; then GPG_TTY="$(tty)"; export GPG_TTY; fi
umask 077

USER_ID="KMK backups <kmk-backup@localhost>"
if [[ "${KMK_KEYGEN_TEST_NOPASS:-}" == 1 ]]; then  # tests only: no passphrase
  gpg --batch --pinentry-mode loopback --passphrase '' --quick-generate-key "$USER_ID" default default never >/dev/null 2>&1
  gpg --batch --pinentry-mode loopback --passphrase '' --export-secret-keys --armor --output "$PRIVATE_OUT" >/dev/null 2>&1
else
  echo "Choose a strong passphrase for the new key when asked (you will be asked for it twice, and again when the key is exported)."
  gpg --quick-generate-key "$USER_ID" default default never
  gpg --export-secret-keys --armor --output "$PRIVATE_OUT"
fi
mkdir -p "$(dirname "$PUBLIC_OUT")"
gpg --batch --export --armor --output "$PUBLIC_OUT"
chmod 600 "$PRIVATE_OUT"; chmod 644 "$PUBLIC_OUT"
FPR="$(gpg --batch --with-colons --list-keys | awk -F: '/^fpr:/ {print $10; exit}')"

echo
echo "Done. Key fingerprint: $FPR"
echo "  private key file:  $PRIVATE_OUT   <- store it (and its passphrase) in your password manager, then DELETE this file"
echo "  public key file:   $PUBLIC_OUT   <- stays on this machine; it can only encrypt, never decrypt"
echo "Without the private key and passphrase the backups can never be restored. Do not keep them on this computer."
