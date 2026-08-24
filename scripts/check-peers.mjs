#!/usr/bin/env node
/**
 * Signale les dépendances de pair obligatoires absentes de node_modules.
 *
 * Pourquoi ce script existe : `.npmrc` fixe `legacy-peer-deps=true` pour
 * contourner un conflit react-dom interne à expo-router. Effet de bord, npm
 * cesse alors d'installer automatiquement les dépendances de pair — elles
 * disparaissent en silence. Deux l'ont été (`react-native-worklets`, requis par
 * Reanimated, et `@expo/metro-runtime`, requis par expo-router) et ne se sont
 * manifestées qu'après trois minutes de build Gradle, ou pas du tout avant
 * l'exécution sur l'appareil.
 *
 * Ce contrôle prend quelques secondes et tourne avant le build.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = "node_modules";

/**
 * Paquets dont les pairs manquants sont sans effet ici : ce sont les
 * dépendances *web* d'expo-router (rendu DOM), et l'application ne cible
 * qu'Android. Installer react-dom ramènerait précisément le conflit de
 * versions que `legacy-peer-deps` contourne.
 */
const IGNORED_PEERS = new Set(["react-dom"]);

/**
 * Pairs déclarés mais jamais importés par le code du paquet, et déjà couverts
 * par un équivalent Expo.
 */
const IGNORED_PAIRS = new Set([
  // Expo fournit `expo/metro-config` à la place.
  "react-native-worklets:@react-native/metro-config",
]);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function collectInstalled() {
  const installed = new Set();
  const walk = (dir, scope) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (!scope && entry.name.startsWith("@")) {
        walk(path.join(dir, entry.name), entry.name);
        continue;
      }
      const name = scope ? `${scope}/${entry.name}` : entry.name;
      if (fs.existsSync(path.join(dir, entry.name, "package.json"))) {
        installed.add(name);
      }
    }
  };
  walk(ROOT, null);
  return installed;
}

const installed = collectInstalled();
if (installed.size === 0) {
  console.error("node_modules introuvable — lance `npm ci` d'abord.");
  process.exit(1);
}

const missing = new Map();
for (const name of installed) {
  const pkg = readJson(path.join(ROOT, name, "package.json"));
  if (!pkg?.peerDependencies) continue;
  const meta = pkg.peerDependenciesMeta ?? {};

  for (const [peer, range] of Object.entries(pkg.peerDependencies)) {
    if (meta[peer]?.optional) continue;
    if (IGNORED_PEERS.has(peer)) continue;
    if (IGNORED_PAIRS.has(`${name}:${peer}`)) continue;
    if (installed.has(peer)) continue;

    if (!missing.has(peer)) missing.set(peer, { range, requiredBy: [] });
    missing.get(peer).requiredBy.push(name);
  }
}

if (missing.size === 0) {
  console.log("Dépendances de pair : aucune absence obligatoire.");
  process.exit(0);
}

console.error(`\n${missing.size} dépendance(s) de pair obligatoire(s) absente(s) :\n`);
for (const [peer, { range, requiredBy }] of missing) {
  console.error(`  ${peer}@${range}`);
  console.error(`    exigé par : ${requiredBy.join(", ")}`);
}
console.error(
  "\nInstalle-les avec `npx expo install <paquet>`, ou ajoute une exception " +
    "justifiée dans scripts/check-peers.mjs si le pair est réellement inutile ici.\n",
);
process.exit(1);
