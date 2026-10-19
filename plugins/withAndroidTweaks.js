const {
  withAndroidManifest,
  withAppBuildGradle,
  AndroidConfig,
} = require("expo/config-plugins");

/**
 * Le modèle GGUF est chargé en mémoire par llama.cpp. Sans `largeHeap`, Android
 * plafonne le tas de l'application (souvent 256 Mo) et l'initialisation du
 * contexte échoue avant même la première inférence.
 */
function withLargeHeap(config) {
  return withAndroidManifest(config, (cfg) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      cfg.modResults,
    );
    application.$["android:largeHeap"] = "true";
    // yt-dlp embarque Python sous forme de bibliothèques natives qu'il doit
    // pouvoir lire comme des fichiers : elles doivent être extraites à
    // l'installation, pas laissées compressées dans l'APK.
    application.$["android:extractNativeLibs"] = "true";
    return cfg;
  });
}

const SIGNING_CONFIG = `
        release {
            // Renseigné par le workflow CI à partir des secrets du dépôt. En
            // l'absence de ces propriétés (build local), on retombe sur la clé
            // de debug pour ne pas casser \`expo run:android\`.
            if (project.hasProperty('KARAKEEP_STORE_FILE')) {
                storeFile file(KARAKEEP_STORE_FILE)
                storePassword KARAKEEP_STORE_PASSWORD
                keyAlias KARAKEEP_KEY_ALIAS
                keyPassword KARAKEEP_KEY_PASSWORD
            } else {
                storeFile file('debug.keystore')
                storePassword 'android'
                keyAlias 'androiddebugkey'
                keyPassword 'android'
            }
        }
`;

/**
 * Le gabarit Expo signe les builds release avec la clé de debug. Android
 * n'autorise une mise à jour sur place que si la nouvelle APK porte la même
 * signature que l'installée : il faut donc une clé stable, sinon le bouton de
 * mise à jour produira un « App not installed » à chaque version.
 */
function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== "groovy") {
      throw new Error(
        "withAndroidTweaks: build.gradle attendu en Groovy, reçu " +
          cfg.modResults.language,
      );
    }
    let contents = cfg.modResults.contents;

    if (contents.includes("KARAKEEP_STORE_FILE")) {
      return cfg;
    }

    // 1. Déclarer le signingConfig `release` à côté de `debug`.
    const anchor = "signingConfigs {";
    const anchorIdx = contents.indexOf(anchor);
    if (anchorIdx === -1) {
      throw new Error("withAndroidTweaks: bloc signingConfigs introuvable");
    }
    contents =
      contents.slice(0, anchorIdx + anchor.length) +
      SIGNING_CONFIG +
      contents.slice(anchorIdx + anchor.length);

    // 2. Faire pointer le buildType release dessus. Le gabarit contient deux
    //    `signingConfig signingConfigs.debug` : celui du buildType debug puis
    //    celui du buildType release. Seul le second doit changer.
    const needle = "signingConfig signingConfigs.debug";
    const occurrences = contents.split(needle).length - 1;
    if (occurrences !== 2) {
      throw new Error(
        `withAndroidTweaks: 2 occurrences de "${needle}" attendues dans build.gradle, ${occurrences} trouvée(s). ` +
          "Le gabarit Expo a probablement changé — vérifier le plugin.",
      );
    }
    const lastIdx = contents.lastIndexOf(needle);
    contents =
      contents.slice(0, lastIdx) +
      "signingConfig signingConfigs.release" +
      contents.slice(lastIdx + needle.length);

    cfg.modResults.contents = contents;
    return cfg;
  });
}

/**
 * Restreint les architectures embarquées quand le workflow le demande.
 *
 * llama.cpp, Python (yt-dlp) et FFmpeg livrent chacun leurs bibliothèques
 * pour quatre processeurs : l'APK dépassait 200 Mo, dont les trois quarts
 * inutiles sur un téléphone ARM 64 bits. `-PKARAKEEP_ABI=arm64-v8a` ne garde
 * que celles-là ; sans la propriété, rien ne change (émulateurs, builds
 * locaux).
 */
const ABI_FILTER = `
        if (project.hasProperty('KARAKEEP_ABI')) {
            ndk { abiFilters KARAKEEP_ABI }
        }`;

function withAbiFilter(config) {
  return withAppBuildGradle(config, (cfg) => {
    let contents = cfg.modResults.contents;
    if (contents.includes("KARAKEEP_ABI")) return cfg;
    const anchor = "defaultConfig {";
    const idx = contents.indexOf(anchor);
    if (idx === -1) throw new Error("withAndroidTweaks: bloc defaultConfig introuvable");
    contents =
      contents.slice(0, idx + anchor.length) + ABI_FILTER + contents.slice(idx + anchor.length);
    cfg.modResults.contents = contents;
    return cfg;
  });
}

module.exports = function withAndroidTweaks(config) {
  return withAbiFilter(withReleaseSigning(withLargeHeap(config)));
};
