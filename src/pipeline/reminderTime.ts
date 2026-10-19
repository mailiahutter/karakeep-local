/**
 * Raccourcis de rappel. Module pur : testable hors appareil.
 */

export interface Preset {
  label: string;
  at: number;
}

function at(base: Date, dayOffset: number, hour: number, minute = 0): number {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

/**
 * Les moments qu'on choisit le plus souvent, sans ouvrir de calendrier :
 * ce soir (s'il n'est pas déjà passé), demain matin, samedi matin, dans une
 * semaine.
 */
export function reminderPresets(now: Date): Preset[] {
  const out: Preset[] = [];
  const tonight = at(now, 0, 20);
  if (tonight - now.getTime() > 30 * 60_000) out.push({ label: "Ce soir, 20 h", at: tonight });
  out.push({ label: "Demain, 9 h", at: at(now, 1, 9) });
  const toSaturday = (6 - now.getDay() + 7) % 7 || 7;
  if (toSaturday > 1) out.push({ label: "Samedi, 10 h", at: at(now, toSaturday, 10) });
  out.push({ label: "Dans une semaine", at: at(now, 7, 9) });
  return out;
}

export function formatWhen(ts: number, now = new Date()): string {
  const d = new Date(ts);
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `aujourd'hui à ${time}`;
  return `${d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })} à ${time}`;
}
