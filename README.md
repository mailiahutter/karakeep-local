# Karakeep Local

Gestionnaire de favoris Android **entièrement local**. Les liens, le texte des
pages et les tags vivent dans une base SQLite sur le téléphone. Le tagging
automatique est fait par un modèle de langage qui tourne sur l'appareil. Aucun
serveur, aucun compte, aucune requête vers un service tiers en dehors des pages
que tu enregistres et du modèle téléchargé une fois.

Dérivé de [karakeep-app/karakeep](https://github.com/karakeep-app/karakeep),
sous licence AGPL-3.0.

---

## Pourquoi ce projet existe

Karakeep est une application **client-serveur** : son client mobile est un
client d'API (`@karakeep/trpc`) qui exige l'adresse d'un serveur au premier
lancement (`apps/mobile/app/server-address.tsx`), et toute la logique vit dans
13 workers côté serveur plus trois conteneurs — l'application web, un **Chrome
headless** pour crawler les pages, et **Meilisearch** pour la recherche.

Rien de tout cela ne tourne sur Android. « Karakeep en local sur le téléphone »
n'est donc pas une option de configuration : c'est une réécriture. Ce dépôt
remplace chaque brique serveur par un équivalent embarqué.

| Karakeep (serveur)          | Karakeep Local (sur l'appareil)            |
| --------------------------- | ------------------------------------------ |
| SQLite côté serveur          | `expo-sqlite` dans l'application            |
| Meilisearch                  | SQLite **FTS5** (`unicode61`, sans accents) |
| Chrome headless (crawler)    | `fetch` + extraction HTML sans DOM          |
| Worker `inference` → OpenAI / Ollama | **llama.cpp embarqué** (`llama.rn`) |
| Files de tâches serveur      | File en mémoire, reprise via l'état en base |

### Ce que cette approche perd

Deux fonctions de Karakeep sont structurellement impossibles ici, et il faut le
savoir avant de choisir :

- **Pas de capture d'écran ni d'archivage complet des pages.** Sans navigateur
  embarqué, on ne dispose que du HTML renvoyé par le serveur. Les pages dont le
  contenu est rendu par JavaScript ne donneront que leurs balises `<meta>`.
- **Pas de téléchargement de vidéos** (yt-dlp) ni d'OCR sur les images.

---

## Fonctionnement

- **Enregistrer un lien** : « Partager » depuis n'importe quelle application, ou
  le bouton `+`. L'écriture est immédiate ; l'extraction et le tagging suivent
  en arrière-plan.
- **Traitement d'arrière-plan** : la file repart au lancement, à chaque retour
  au premier plan, et — application fermée — sur un réveil confié à WorkManager.
  Le système choisit le moment à partir d'un intervalle minimal de 15 minutes :
  un lien partagé puis l'application aussitôt refermée est traité dans le
  quart d'heure qui suit, pas à la seconde. Le bandeau d'accueil dit ce qui est
  en cours et ce qui attend, avec un bouton pour relancer tout de suite.
  L'extraction, elle, a besoin de la WebView : elle ne tourne que dans
  l'application ouverte.
- **Thèmes et sous-thèmes** modifiables : Réglages → « Thèmes et sous-thèmes »,
  ou le bouton « Gérer les thèmes » de l'onglet Thèmes. Chaque catégorie porte
  une **description**, et c'est elle que le modèle lit pour ranger un lien —
  « Moto › Ma sélection » et « Destinations roadtrip › Roadtrip moto » ne se
  distinguent que par là. Écrite comme on l'expliquerait à quelqu'un
  (« modèles de motos que j'envisage d'acheter »), elle vaut mieux qu'un
  intitulé court. Supprimer une catégorie ne supprime aucun lien : ceux qui y
  étaient redeviennent non rangés.
- **Choix du modèle** : c'est le processeur qui décide, pas la mémoire —
  llama.cpp tourne sur les cœurs, pas sur le GPU. Un téléphone peut loger un
  modèle de 7 milliards de paramètres sans pouvoir le faire répondre en un
  temps acceptable : compter 5 à 10 minutes par lien, contre 1 à 3 pour un 3B.
  Chaque inférence a une limite de temps ; au-delà, elle est arrêtée et le lien
  passe en erreur avec la raison, plutôt que de bloquer la file.
- **Relecture des propositions** : à l'ouverture, l'application récapitule ce
  que le modèle a décidé — thème, tags, images, résumé — et attend un verdict
  par aspect, plus un commentaire libre. Ce qui est jugé est figé au moment de
  l'avis : une correction faite ensuite ne rend pas le retour incompréhensible.
  Réglages → « Retours sur l'IA » exporte les avis non encore transmis dans un
  fichier Markdown, via la feuille de partage d'Android. Rien ne quitte
  l'appareil sans cette action.
- **Recherche plein texte** sur le titre, la description et le contenu extrait,
  classée par pertinence (`bm25`), insensible aux accents.
- **Tags** générés par le modèle embarqué, complétables et corrigeables à la
  main. Un tag posé à la main n'est jamais écrasé par le modèle.
- **Mise à jour intégrée** : Réglages → « Rechercher une mise à jour ». Le
  bouton interroge les releases GitHub du dépôt, compare les versions, télécharge
  l'APK et passe la main à l'installeur Android.

---

## Paramètres à décider

Ces choix sont modifiables plus tard, mais autant les faire en connaissance de
cause.

### 1. Le modèle de tagging

Réglages → Modèle IA. Quatre modèles GGUF quantifiés `Q4_K_M` :

| Modèle                 | Taille  | RAM conseillée | Remarque                                   |
| ---------------------- | ------- | -------------- | ------------------------------------------ |
| **Qwen 2.5 3B**        | 1,8 Go  | 8 Go et plus   | Défaut. Bon en français, respecte le format JSON. |
| Llama 3.2 3B           | 1,9 Go  | 8 Go et plus   | Qualité comparable, un peu plus lourd.     |
| Qwen 2.5 1.5B          | 940 Mo  | 6 Go           | Deux fois plus rapide, tags plus génériques.|
| Gemma 3 1B             | 769 Mo  | 4 Go           | Pour les appareils modestes.               |

Le modèle est téléchargé une fois (**à faire en Wi-Fi**), puis conservé. Il est
chargé en RAM à la demande et déchargé après trois minutes d'inactivité.

### 2. La langue et le style des tags

Par défaut : tags en **français**, style `minuscules-avec-traits-union`. Six
styles disponibles, repris de Karakeep (`camelCase`, `Titre Avec Espaces`, etc.).

### 3. Le traitement automatique

Deux interrupteurs, activés par défaut :

- **Tagger automatiquement** — génère les tags après chaque enregistrement.
- **Lire le contenu des pages** — télécharge et extrait le texte. Le désactiver
  rend la recherche plein texte beaucoup moins utile.

### 4. Le dépôt interrogé pour les mises à jour

Défini dans `app.config.ts` (`extra.updateRepo`), surchargeable à la
construction par `UPDATE_REPO_OWNER` / `UPDATE_REPO_NAME`. Le workflow le
renseigne automatiquement avec le dépôt courant.

**Le dépôt doit être public** : l'application ne porte aucun jeton GitHub, et en
embarquer un dans une APK distribuée reviendrait à le publier. C'est aussi ce
qu'impose l'AGPL-3.0 héritée de Karakeep.

---

## Installation

1. Génère ta clé de signature et publie une première version :
   voir **[docs/SIGNATURE.md](docs/SIGNATURE.md)**.
2. Télécharge l'APK depuis la page des releases, sur le téléphone.
3. Ouvre le fichier ; autorise l'installation depuis une source inconnue.
4. Au premier lancement, va dans Réglages → Modèle IA et télécharge un modèle.

Les mises à jour suivantes passent par le bouton dans l'application.

---

## Développement

```bash
npm install
npm test          # 43 tests, sans appareil ni émulateur
npm run typecheck
npm run android   # nécessite un SDK Android et un appareil connecté
```

La logique testable est volontairement séparée des modules React Native :
extraction HTML, normalisation d'URL, construction des requêtes FTS5, prompts et
lecture des réponses du modèle, comparaison de versions.

### Organisation

```
app/                      écrans (expo-router)
src/
  ai/        catalogue de modèles, téléchargement, llama.cpp, prompts
  capture/   téléchargement de page et extraction sans DOM
  db/        SQLite, migrations, requêtes, réglages
  pipeline/  file de traitement en arrière-plan
  ui/        thème et composants
  update/    comparaison de versions, releases GitHub, installation
plugins/     plugin de configuration Expo (signature, largeHeap)
```

## Licence

AGPL-3.0-only, héritée de Karakeep. Les prompts de tagging sont adaptés de
`packages/shared/prompts.ts` du projet d'origine.
