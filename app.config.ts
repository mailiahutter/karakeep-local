import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * La version affichée dans l'app et comparée aux releases GitHub par le bouton
 * de mise à jour. Le workflow CI la dérive du tag git.
 */
const VERSION = process.env.APP_VERSION ?? "1.0.0";

/**
 * Android refuse d'installer une mise à jour dont le versionCode n'est pas
 * strictement supérieur à celui installé. Le CI l'incrémente via le numéro de run.
 */
const VERSION_CODE = Number(process.env.APP_VERSION_CODE ?? "1");

/**
 * Dépôt interrogé par le bouton « Rechercher une mise à jour ». Surchargeable
 * pour pointer vers un fork sans toucher au code.
 */
const UPDATE_OWNER = process.env.UPDATE_REPO_OWNER ?? "mailiahutter";
const UPDATE_REPO = process.env.UPDATE_REPO_NAME ?? "karakeep-local";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Karakeep Local",
  slug: "karakeep-local",
  version: VERSION,
  orientation: "portrait",
  icon: "./assets/icon.png",
  scheme: "karakeeplocal",
  userInterfaceStyle: "automatic",
  // La New Architecture est active d'office depuis le SDK 57 : plus de clé à
  // positionner. llama.rn la prend en charge (spec TurboModule + codegenConfig).
  android: {
    package: "app.karakeep.local",
    versionCode: VERSION_CODE,
    adaptiveIcon: {
      backgroundColor: "#0F172A",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
    permissions: [
      "android.permission.INTERNET",
      // Nécessaire pour que le bouton de mise à jour puisse lancer l'installeur.
      "android.permission.REQUEST_INSTALL_PACKAGES",
      // Sans elle, la progression du téléchargement du modèle resterait
      // invisible sur Android 13 et suivants.
      "android.permission.POST_NOTIFICATIONS",
    ],
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: "app.karakeep.local",
  },
  plugins: [
    "expo-router",
    [
      // La recherche plein texte remplace Meilisearch : FTS5 doit être compilé
      // dans le SQLite embarqué.
      "expo-sqlite",
      { enableFTS: true },
    ],
    "expo-web-browser",
    "expo-splash-screen",
    [
      "expo-build-properties",
      {
        android: {
          // llama.cpp a besoin de C++17 et d'un minSdk récent pour les
          // instructions vectorielles ARM utilisées par les noyaux quantifiés.
          minSdkVersion: 26,
          compileSdkVersion: 36,
          targetSdkVersion: 36,
          // Le modèle GGUF est mappé en mémoire : sans largeHeap, l'allocation
          // du contexte échoue sur certaines ROMs.
          enableProguardInReleaseBuilds: false,
        },
      },
    ],
    [
      "expo-share-intent",
      {
        // On ne récupère que du texte : une URL partagée depuis le navigateur,
        // un lecteur RSS, un client mail…
        androidIntentFilters: ["text/*"],
        disableIOS: true,
      },
    ],
    // Déclare le service de téléchargement d'arrière-plan dans le manifeste.
    "@kesha-antonov/react-native-background-downloader",
    "./plugins/withAndroidTweaks",
  ],
  extra: {
    router: {},
    eas: {},
    updateRepo: {
      owner: UPDATE_OWNER,
      repo: UPDATE_REPO,
    },
  },
});
