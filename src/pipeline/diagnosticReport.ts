import { getDb } from "../db/client";
import { loadSettings } from "../db/settings";
import { findModel } from "../ai/models";
import { isModelInstalled } from "../ai/download";
import { isEmbedderInstalled } from "../ai/embed";
import { readBackgroundLog } from "./heartbeat";
import { connectionKind } from "../ai/download";
import { currentBuild, currentVersion } from "../update/updater";
import { isCharging, modeStatus, scheduledWindow, workerDiagnostics, isWorkerAvailable } from "../../modules/karakeep-worker/src";

/**
 * Journal à transmettre pour comprendre pourquoi rien n'avance.
 *
 * Le journal vit sur le téléphone ; personne d'autre ne peut le lire. Ce
 * rapport en texte simple se colle dans un message : réglages Android qui
 * bloquent, état de la file étape par étape, et derniers réveils. Aucune
 * adresse ni contenu de lien n'y figure.
 */
export async function buildDiagnosticReport(): Promise<string> {
  const db = await getDb();
  const settings = await loadSettings();
  const model = findModel(settings.modelId);
  const counts = await db.getFirstAsync<Record<string, number | null>>(`
    SELECT
      SUM(fetch_status = 'pending') AS fetch_pending,
      SUM(fetch_status = 'running') AS fetch_running,
      SUM(fetch_status = 'error' AND source_gone = 0) AS fetch_retry,
      SUM(source_gone = 1) AS gone,
      SUM(ai_status = 'pending') AS ai_pending,
      SUM(ai_status = 'pending' AND fetch_status <> 'success') AS ai_waiting_fetch,
      SUM(ai_status = 'error') AS ai_error,
      SUM(ai_status = 'skipped') AS ai_skipped,
      SUM(theme_id IS NULL AND ai_status = 'success') AS unfiled,
      COUNT(*) AS total
    FROM bookmarks WHERE archived = 0`);
  const errors = await db.getAllAsync<{ e: string; n: number }>(`
    SELECT COALESCE(ai_error, fetch_error) AS e, COUNT(*) AS n FROM bookmarks
     WHERE archived = 0 AND (ai_status = 'error' OR fetch_status = 'error' OR ai_status = 'skipped')
     GROUP BY e ORDER BY n DESC LIMIT 8`);
  const diag = workerDiagnostics();
  const win = scheduledWindow();
  const log = await readBackgroundLog();
  const fmt = (ts: number) =>
    new Date(ts).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const c = (k: string) => counts?.[k] ?? 0;

  return [
    `Karakeep Local ${currentVersion()} (${currentBuild()}) — rapport du ${fmt(Date.now())}`,
    "",
    "## Réglages Android",
    `Service natif : ${isWorkerAvailable() ? "présent" : "ABSENT"}`,
    `Alarmes exactes autorisées : ${diag ? (diag.canScheduleExact ? "oui" : "NON") : "?"}`,
    `Hors optimisation de batterie : ${diag ? (diag.ignoringBatteryOptimizations ? "oui" : "NON") : "?"}`,
    `Séance de nuit programmée : ${win ? `${String(win.hour).padStart(2, "0")}:${String(win.minute).padStart(2, "0")}` : "AUCUNE"} (réglage : ${settings.nightlyWork || "vide"})`,
    `Dernier déclenchement : ${diag?.lastAlarmResult ?? "jamais"}${diag?.lastAlarmAt ? ` le ${fmt(diag.lastAlarmAt)}` : ""}`,
    `Réseau maintenant : ${await connectionKind()} — sur secteur : ${isCharging() ? "oui" : "non"}`,
    `Mode Karakeep : ${(() => {
      const m = modeStatus();
      return m ? `${m.active ? "actif" : "inactif"}, automatique la nuit : ${m.auto ? "oui" : "non"}, autorisé : ${m.permitted ? "oui" : "non"}, appels refusés : ${m.blocksCalls ? "oui" : "non"}, silence : ${m.quietAccess ? "oui" : "non"}` : "indisponible";
    })()}`,
    "",
    "## Modèles",
    `Modèle : ${model?.label ?? settings.modelId} — ${model && (await isModelInstalled(model)) ? "installé" : "PAS INSTALLÉ"}`,
    `Modèle de proximité : ${(await isEmbedderInstalled()) ? "installé" : "absent"}`,
    "",
    "## File",
    `Liens : ${c("total")}`,
    `Pages à lire : ${c("fetch_pending")} (en cours : ${c("fetch_running")}, réessai prévu : ${c("fetch_retry")}, disparues : ${c("gone")})`,
    `Analyses à faire : ${c("ai_pending")} dont ${c("ai_waiting_fetch")} attendent la lecture de leur page`,
    `Analyses en erreur : ${c("ai_error")} — sautées : ${c("ai_skipped")} — rangées sans tiroir : ${c("unfiled")}`,
    ...(errors.length ? ["", "## Erreurs les plus fréquentes", ...errors.map((e) => `${e.n} × ${e.e ?? "?"}`)] : []),
    "",
    "## Derniers réveils",
    ...(log.length ? log.slice(0, 40).map((r) => `${fmt(r.at)} — ${r.outcome}`) : ["Aucun réveil enregistré."]),
  ].join("\n");
}
