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

module.exports = function withAndroidTweaks(config) {
  return withReleaseSigning(withLargeHeap(config));
};
