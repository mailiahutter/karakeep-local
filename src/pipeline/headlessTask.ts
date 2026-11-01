import { AppRegistry } from "react-native";

import { countPendingWork, pendingSnapshot } from "../db/bookmarks";
import { recordBackgroundRun } from "./heartbeat";
import { isQueueLockHeld } from "./lock";
import { isProcessing, processPending } from "./queue";
import { isCharging } from "../../modules/karakeep-worker/src";

/**
 * Travail exécuté par le service au premier plan, sans interface.
 *
 * Android démarre ici le moteur JavaScript dans un processus qui n'affiche
 * rien. C'est le même pipeline que celui de l'interface — extraction sans
 * moteur de rendu, puis analyse par le modèle — et c'est volontaire :
 * dupliquer la logique aurait garanti deux comportements divergents.
 *
 * La séance s'arrête d'elle-même quand il n'y a plus rien à faire. Le service
 * natif impose par ailleurs sa propre borne, Android limitant un service
 * `dataSync` à six heures par jour.
 */

export const HEADLESS_TASK = "KarakeepWork";

/** Marges sous les bornes du service natif (5 h la nuit, 20 min le jour). */
const NIGHT_BUDGET_MS = 4 * 60 * 60_000 + 50 * 60_000;
const DAY_BUDGET_MS = 18 * 60_000;

interface SessionData {
  /** `night` : séance programmée ; `day` : passage de jour ; `share` : après un partage. */
  kind?: "night" | "day" | "share";
  charging?: boolean;
}

export async function runHeadlessSession(data: SessionData = {}): Promise<void> {
  const kind = data.kind ?? "night";
  // Deux contextes llama.cpp chargés en même temps, ce sont dix gigaoctets
  // demandés d'un coup : le système en tuerait un. L'interface est
  // prioritaire, elle traite déjà la file.
  //
  // Plutôt que d'abandonner, on attend que l'autre cycle ait fini : le
  // service au premier plan garde le processus en vie pendant ce temps.
  // Abandonner, c'était laisser Android tuer l'application dès que
  // l'utilisateur revenait à Instagram, au milieu de la lecture de la page.
  const waitUntil = Date.now() + (kind === "night" ? 30 : 15) * 60_000;
  while (isProcessing() || (await isQueueLockHeld())) {
    if (Date.now() > waitUntil) {
      await recordBackgroundRun("Séance ignorée : un autre traitement ne se termine pas.");
      return;
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }

  const before = await countPendingWork();
  if (before === 0) {
    await recordBackgroundRun(`Séance (${kind}) : rien à traiter — ${await pendingSnapshot()}.`);
    return;
  }

  const label = kind === "night" ? "Séance de nuit" : kind === "day" ? "Passage de jour" : "Après partage";
  // L'analyse ne tourne que la nuit, sur secteur ; le reste du temps, on lit
  // seulement les pages. Débrancher en pleine nuit l'arrête aussitôt.
  const analyse = kind === "night" && isCharging();
  await recordBackgroundRun(
    `${label} démarré(e) — ${await pendingSnapshot()}${
      analyse ? "" : kind === "night" ? " — téléphone sur batterie : lecture des pages seulement, analyse reportée" : " — lecture des pages seulement"
    }.`,
  );
  try {
    await processPending({
      headless: true,
      budgetMs: kind === "night" ? NIGHT_BUDGET_MS : DAY_BUDGET_MS,
      analyse,
      stopAnalysis: () => !isCharging(),
    });
    const after = await countPendingWork();
    await recordBackgroundRun(
      before === after
        ? `${label} terminé(e) sans progrès, ${after} toujours en attente.`
        : `${label} : ${before - after} traité(s), ${after} restant(s).`,
    );
  } catch (err) {
    await recordBackgroundRun(`Séance interrompue : ${(err as Error).message}`);
    throw err;
  }
}

/**
 * Déclaration à l'évaluation du module, et non dans une fonction appelée
 * ensuite : les imports étant hissés, un appel écrit après eux s'exécuterait
 * après l'enregistrement du composant racine. Quand le service démarre le
 * moteur sans interface, aucun écran n'est monté — une tâche déclarée depuis
 * un composant n'existerait tout simplement pas.
 */
AppRegistry.registerHeadlessTask(HEADLESS_TASK, () => (data: SessionData) => runHeadlessSession(data ?? {}));
