/**
 * Critères appris : ce que l'utilisateur range vraiment dans chaque tiroir.
 *
 * Demande du 21 octobre : que l'IA « complète au fur et à mesure des
 * habitudes, pour chaque thème et sous-thème, les critères pour les mettre
 * dedans ». La nuit, le modèle relit les liens que l'utilisateur a rangés ou
 * validés dans un tiroir — et ceux qu'il en a retirés — et en tire une ou
 * deux phrases. Elles sont ensuite montrées au modèle à côté de la
 * description écrite par l'utilisateur, à chaque classement.
 *
 * Module pur : testable hors appareil.
 */

export const MAX_CRITERIA_CHARS = 280;
/** Liens rangés à la main nécessaires avant d'oser généraliser. */
export const MIN_EXAMPLES = 3;

export const CRITERIA_SYSTEM_PROMPT =
  "Tu résumes des habitudes de rangement en critères courts et concrets, en français. " +
  "Tu n'inventes rien : tu généralises à partir des exemples fournis.";

export function buildCriteriaPrompt(
  target: { name: string; description: string | null; parent: string | null },
  positives: string[],
  negatives: string[],
): string {
  const label = target.parent ? `« ${target.parent} › ${target.name} »` : `« ${target.name} »`;
  const pos = positives.map((p) => `- ${oneLine(p)}`).join("\n");
  const neg = negatives.length
    ? `\nL'utilisateur a RETIRÉ de cette catégorie :\n${negatives.map((n) => `- ${oneLine(n)}`).join("\n")}\n`
    : "";
  return `Catégorie ${label}${target.description ? ` — consigne de l'utilisateur : « ${target.description} »` : ""}.

L'utilisateur y a rangé lui-même :
${pos}
${neg}
Écris en une ou deux phrases (${MAX_CRITERIA_CHARS} caractères au plus) les critères qui font qu'un lien va dans cette catégorie : les sujets, objets ou situations concrets qui reviennent${negatives.length ? ", puis ce qui n'y va pas" : ""}. Commence directement par les critères, sans phrase d'introduction.`;
}

function oneLine(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= 120 ? t : `${t.slice(0, 119)}…`;
}

export function parseCriteria(raw: string): string | null {
  let text = raw
    .replace(/```[a-z]*|```/gi, "")
    .replace(/^\s*(crit[èe]res?\s*:\s*)/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["«»“”\s]+|["«»“”\s]+$/g, "");
  if (text.length < 15) return null;
  if (text.length > MAX_CRITERIA_CHARS) {
    const cut = text.slice(0, MAX_CRITERIA_CHARS);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(" ; "));
    text = end > 80 ? cut.slice(0, end + 1).trim() : `${cut.trimEnd()}…`;
  }
  return text;
}

/**
 * Faut-il (ré)apprendre ? Dès trois liens, puis à chaque fois que le tiroir a
 * grossi d'un tiers (au moins trois liens) depuis la dernière fois : assez
 * pour que l'habitude ait pu changer, pas au point de tout réécrire à chaque
 * rangement.
 */
export function needsLearning(learnedFrom: number, trusted: number): boolean {
  if (trusted < MIN_EXAMPLES) return false;
  if (learnedFrom === 0) return true;
  return trusted - learnedFrom >= Math.max(3, Math.ceil(learnedFrom / 3));
}
