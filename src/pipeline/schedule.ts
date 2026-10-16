/**
 * Lecture de l'heure choisie pour la séance de travail.
 *
 * Module pur : testable hors appareil.
 */

export interface WorkWindow {
  hour: number;
  minute: number;
}

/** « 03:00 » → { hour: 3, minute: 0 }. Chaîne vide ou invalide → aucune séance. */
export function parseWindow(raw: string): WorkWindow | null {
  const match = raw.trim().match(/^(\d{1,2})\s*[:hH]\s*(\d{1,2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export function formatWindow(window: WorkWindow | null): string {
  if (!window) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(window.hour)}:${pad(window.minute)}`;
}

/**
 * Prochaine occurrence d'une heure donnée, en millisecondes.
 *
 * Le même calcul existe côté natif, qui pose l'alarme ; celui-ci sert à
 * annoncer la prochaine séance sans interroger le système.
 */
export function nextOccurrence(window: WorkWindow, now = Date.now()): number {
  const next = new Date(now);
  next.setHours(window.hour, window.minute, 0, 0);
  if (next.getTime() <= now) next.setDate(next.getDate() + 1);
  return next.getTime();
}

/** « dans 7 h 20 » : ce que l'utilisateur veut lire, pas un horodatage. */
export function untilLabel(at: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((at - now) / 60_000));
  if (minutes < 60) return `dans ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `dans ${hours} h` : `dans ${hours} h ${rest}`;
}
