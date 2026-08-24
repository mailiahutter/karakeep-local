#!/usr/bin/env bash
#
# Génère la clé de signature Android de l'application et affiche les quatre
# secrets à déposer sur GitHub.
#
# À exécuter UNE SEULE FOIS. Android n'autorise une mise à jour sur place que si
# la nouvelle APK porte la même signature que celle installée : régénérer la clé
# plus tard obligerait à désinstaller l'application, donc à perdre les favoris.
#
# Usage : ./scripts/generate-keystore.sh [chemin-de-sortie]

set -euo pipefail

OUT="${1:-release.keystore}"
ALIAS="karakeep-local"

if [ -e "$OUT" ]; then
  echo "Erreur : $OUT existe déjà. Refus d'écraser une clé existante." >&2
  echo "Si tu veux vraiment repartir de zéro, déplace ce fichier d'abord." >&2
  exit 1
fi

command -v keytool >/dev/null 2>&1 || {
  echo "Erreur : keytool est introuvable. Installe un JDK (par ex. Temurin 17)." >&2
  exit 1
}

# Mot de passe aléatoire : il n'a pas à être mémorisable, il vivra dans les
# secrets GitHub et dans ta gestion de mots de passe.
# `head -c` ferme le tube avant que `tr` ait fini d'écrire, ce qui lui vaut un
# SIGPIPE : on relâche pipefail le temps de cette ligne.
set +o pipefail
PASSWORD="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)"
set -o pipefail

if [ "${#PASSWORD}" -ne 32 ]; then
  echo "Erreur : génération du mot de passe échouée (${#PASSWORD} caractères)." >&2
  exit 1
fi

keytool -genkeypair -v \
  -keystore "$OUT" \
  -alias "$ALIAS" \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10950 \
  -storepass "$PASSWORD" \
  -keypass "$PASSWORD" \
  -dname "CN=Karakeep Local, OU=Personnel, O=Karakeep Local, L=Inconnu, C=FR"

CREDS="keystore-credentials.txt"
{
  echo "# Secrets GitHub pour le workflow de publication"
  echo "# Dépôt → Settings → Secrets and variables → Actions → New repository secret"
  echo
  echo "KEYSTORE_PASSWORD=$PASSWORD"
  echo "KEY_ALIAS=$ALIAS"
  echo "KEY_PASSWORD=$PASSWORD"
  echo
  echo "# KEYSTORE_BASE64 (contenu du fichier $OUT encodé) :"
  base64 -w0 "$OUT" 2>/dev/null || base64 "$OUT" | tr -d '\n'
  echo
} > "$CREDS"

chmod 600 "$OUT" "$CREDS"

cat <<EOF

Clé générée : $OUT
Secrets à déposer : $CREDS

Les deux fichiers sont ignorés par git (.gitignore) et ne doivent JAMAIS être
publiés. Sauvegarde-les hors du dépôt : sans eux, plus aucune mise à jour ne
pourra être installée par-dessus la version en place.

Prochaine étape : docs/SIGNATURE.md
EOF
