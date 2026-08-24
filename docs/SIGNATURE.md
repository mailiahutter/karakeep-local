# Clé de signature et publication

## Pourquoi c'est le point le plus important

Android n'installe une mise à jour par-dessus une application existante que si
les deux APK sont signées **avec la même clé**. Si la clé change, l'installeur
répond « application non installée » sans plus d'explication, et le seul recours
est de désinstaller — ce qui **efface tous les favoris**, la base étant locale.

La clé se génère donc une fois, et se conserve.

## 1. Générer la clé (une seule fois, sur ta machine)

```bash
./scripts/generate-keystore.sh
```

Le script produit deux fichiers, tous deux ignorés par git :

| Fichier                    | Contenu                                        |
| -------------------------- | ---------------------------------------------- |
| `release.keystore`         | La clé privée de signature                     |
| `keystore-credentials.txt` | Les quatre secrets à déposer sur GitHub        |

**Sauvegarde ces deux fichiers hors du dépôt** (gestionnaire de mots de passe,
disque chiffré). Ils ne sont pas reconstituables.

## 2. Déposer les secrets sur GitHub

Dépôt → **Settings** → **Secrets and variables** → **Actions** →
**New repository secret**. Quatre secrets, repris de `keystore-credentials.txt` :

| Nom du secret       | Valeur                                          |
| ------------------- | ----------------------------------------------- |
| `KEYSTORE_BASE64`   | La longue chaîne base64 en fin de fichier        |
| `KEYSTORE_PASSWORD` | La valeur de `KEYSTORE_PASSWORD`                 |
| `KEY_ALIAS`         | `karakeep-local`                                 |
| `KEY_PASSWORD`      | La valeur de `KEY_PASSWORD` (identique à l'autre)|

Le workflow échoue volontairement, avec un message explicite, si
`KEYSTORE_BASE64` manque : mieux vaut ne rien publier qu'une APK signée avec la
clé de debug, qui serait une impasse pour toutes les mises à jour suivantes.

## 3. Publier une version

```bash
git tag v1.0.0
git push origin v1.0.0
```

Le workflow `.github/workflows/release.yml` se déclenche et :

1. vérifie les types et lance les tests ;
2. génère le projet Android (`expo prebuild`) en injectant la version depuis le
   tag et un `versionCode` égal au numéro de run ;
3. construit l'APK release et la signe avec ta clé ;
4. **vérifie que la signature n'est pas celle de debug** et échoue sinon ;
5. crée la release GitHub avec l'APK en pièce jointe.

C'est exactement cette pièce jointe que le bouton « Rechercher une mise à jour »
de l'application télécharge.

## Contraintes de numérotation

- Le tag doit suivre `vMAJEUR.MINEUR.CORRECTIF` (ex. `v1.2.0`). L'application
  compare les versions selon les règles semver.
- Le `versionCode` Android doit être **strictement croissant**. Il vient du
  numéro de run du workflow, donc il augmente tout seul — ne relance pas un
  ancien tag en espérant republier à l'identique.

## Première installation

La toute première APK s'installe à la main : télécharge-la depuis la page des
releases sur le téléphone et ouvre le fichier. Android demandera l'autorisation
d'installer depuis une source inconnue. Ensuite, toutes les mises à jour passent
par le bouton dans l'application.
