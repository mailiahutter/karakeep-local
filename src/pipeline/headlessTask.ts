import { AppRegistry, AppState } from "react-native";

import { countPendingWork } from "../db/bookmarks";
import { recordBackgroundRun } from "./heartbeat";
import { isQueueLockHeld } from "./lock";
import { processPending } from "./queue";

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

/** Marge sous la borne du service natif, pour finir proprement. */
const SESSION_BUDGET_MS = 50 * 60_000;

export async function runHeadlessSession(): Promise<void> {
  // Deux contextes llama.cpp chargés en même temps, ce sont dix gigaoctets
  // demandés d'un coup : le système en tuerait un. L'interface est
  // prioritaire, elle traite déjà la file.
  if (AppState.currentState === "active" || (await isQueueLockHeld())) {
    await recordBackgroundRun("Séance ignorée : traitement déjà en cours.");
    return;
  }

  const before = await countPendingWork();
  if (before === 0) {
    await recordBackgroundRun("Séance : rien à traiter.");
    return;
  }

  await recordBackgroundRun(`Séance démarrée, ${before} lien(s) en attente.`);
  try {
    await processPending({ headless: true, budgetMs: SESSION_BUDGET_MS });
    const after = await countPendingWork();
    await recordBackgroundRun(
      before === after
        ? `Séance terminée sans progrès, ${after} toujours en attente.`
        : `Séance : ${before - after} traité(s), ${after} restant(s).`,
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
AppRegistry.registerHeadlessTask(HEADLESS_TASK, () => runHeadlessSession);
