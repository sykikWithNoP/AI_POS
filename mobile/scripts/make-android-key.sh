#!/bin/sh
# Creates YOUR Android signing key for NINDITO POS Mobile (once, ever) and prints the four values to
# paste into GitHub: repository Settings → Secrets and variables → Actions → New repository secret.
# Keep nindito-release.jks and its password safe and offline: phones only accept updates signed with
# this same key. If it is lost, installed apps cannot be updated (they must be reinstalled).
# Needs Java's keytool (comes with any Java / Android Studio install).
set -e
FILE="${1:-nindito-release.jks}"
ALIAS="nindito"
if [ -e "$FILE" ]; then echo "$FILE already exists — not overwriting it."; exit 1; fi
printf "Choose a strong password for the key (it is not shown): "
stty -echo; read -r PASS; stty echo; echo
[ ${#PASS} -ge 12 ] || { echo "Use at least 12 characters."; exit 1; }
keytool -genkeypair -keystore "$FILE" -alias "$ALIAS" -keyalg RSA -keysize 4096 -validity 36500 \
  -dname "CN=NINDITO POS" -storepass "$PASS" -keypass "$PASS" >/dev/null
echo
echo "Created $FILE. Add these repository secrets on GitHub:"
echo "  ANDROID_KEYSTORE_BASE64   = the contents of $FILE.base64 (created next to it)"
echo "  ANDROID_KEYSTORE_PASSWORD = the password you just typed"
echo "  ANDROID_KEY_ALIAS         = $ALIAS"
echo "  ANDROID_KEY_PASSWORD      = the password you just typed"
base64 < "$FILE" | tr -d '\n' > "$FILE.base64"
echo
echo "Then delete $FILE.base64 and keep $FILE somewhere safe and offline."
