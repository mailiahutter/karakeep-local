/**
 * Mise en forme des retours pour transmission.
 *
 * Le fichier produit est destiné à être lu par un humain autant que par un
 * assistant : du Markdown, pas du JSON. Un tableau de clés brutes obligerait à
 * décoder mentalement chaque champ avant de comprendre le reproche.
 *
 * Module pur : testable hors appareil.
 */

export type Verdict = "good" | "bad" | null;

/** Ce que le modèle avait proposé, figé au moment de l'avis. */
export interface ReviewSnapshot {
  url: string;
  title: string | null;
  sourceKind: string;
  /**
   * Ce que le modèle a compris du document. C'est la pièce qui distingue un
   * sujet mal lu d'un rangement mal choisi.
   */
  subject: string | null;
  theme: string | null;
  tags: string[];
  /** Une ligne par pièce conservée : « image 80 Ko ». */
  assets: string[];
  summary: string | null;
  modelId: string;
}

export interface ReviewEntry {
  id: string;
  createdAt: number;
  themeVerdict: Verdict;
  tagsVerdict: Verdict;
  mediaVerdict: Verdict;
  summaryVerdict: Verdict;
  comment: string | null;
  snapshot: ReviewSnapshot;
}

export interface ExportMeta {
  appVersion: string;
  generatedAt: number;
}

/** Un avis sans verdict ni commentaire n'apprend rien : il n'est pas exporté. */
export function hasOpinion(entry: ReviewEntry): boolean {
  return (
    entry.themeVerdict !== null ||
    entry.tagsVerdict !== null ||
    entry.mediaVerdict !== null ||
    entry.summaryVerdict !== null ||
    (entry.comment ?? "").trim().length > 0
  );
}

function mark(verdict: Verdict): string {
  if (verdict === "good") return "✅ correct";
  if (verdict === "bad") return "❌ à revoir";
  return "— sans avis";
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

/** Compte les verdicts, pour situer d'un coup d'œil ce qui pose problème. */
export function tally(entries: ReviewEntry[]): Record<string, string> {
  const aspects = {
    Thème: "themeVerdict",
    Tags: "tagsVerdict",
    "Images et vidéos": "mediaVerdict",
    Résumé: "summaryVerdict",
  } as const;

  const out: Record<string, string> = {};
  for (const [label, key] of Object.entries(aspects)) {
    const values = entries.map((e) => e[key as keyof ReviewEntry] as Verdict);
    const good = values.filter((v) => v === "good").length;
    const bad = values.filter((v) => v === "bad").length;
    if (good + bad > 0) out[label] = `${good} correct · ${bad} à revoir`;
  }
  return out;
}

/**
 * Construit le document à transmettre.
 *
 * Les avis sans contenu sont écartés en amont : exporter des lignes vides
 * diluerait les vrais reproches.
 */
export function buildFeedbackMarkdown(
  entries: ReviewEntry[],
  meta: ExportMeta,
): string {
  const kept = entries.filter(hasOpinion);
  const lines: string[] = [
    "# Retours sur les propositions du modèle — Karakeep Local",
    "",
    `- Version de l'application : ${meta.appVersion}`,
    `- Export du ${isoDay(meta.generatedAt)}`,
    `- Avis transmis : ${kept.length}`,
  ];

  const models = [...new Set(kept.map((e) => e.snapshot.modelId))];
  if (models.length > 0) {
    lines.push(`- Modèle utilisé : ${models.join(", ")}`);
  }

  const counts = tally(kept);
  if (Object.keys(counts).length > 0) {
    lines.push("", "## Vue d'ensemble", "");
    for (const [label, value] of Object.entries(counts)) {
      lines.push(`- **${label}** : ${value}`);
    }
  }

  if (kept.length === 0) {
    lines.push("", "Aucun avis à transmettre.");
    return lines.join("\n") + "\n";
  }

  lines.push("", "## Détail", "");

  for (const entry of kept) {
    const s = entry.snapshot;
    lines.push(`### ${s.title ?? s.url}`);
    lines.push("");
    lines.push(`- Lien : ${s.url}`);
    lines.push(`- Type de source : ${s.sourceKind}`);
    lines.push(`- Compris par le modèle : ${s.subject ?? "rien"}`);
    lines.push(`- Thème proposé : ${s.theme ?? "aucun"} → ${mark(entry.themeVerdict)}`);
    lines.push(
      `- Tags proposés : ${s.tags.length > 0 ? s.tags.join(", ") : "aucun"} → ${mark(entry.tagsVerdict)}`,
    );
    lines.push(
      `- Pièces conservées : ${s.assets.length > 0 ? s.assets.join(", ") : "aucune"} → ${mark(entry.mediaVerdict)}`,
    );
    lines.push(`- Résumé : ${mark(entry.summaryVerdict)}`);
    if (s.summary) {
      lines.push(`  > ${s.summary.replace(/\n+/g, " ")}`);
    }
    if (entry.comment && entry.comment.trim().length > 0) {
      lines.push("", `**Commentaire :** ${entry.comment.trim()}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/** Nom de fichier daté, pour que plusieurs exports ne s'écrasent pas. */
export function feedbackFileName(generatedAt: number): string {
  const stamp = new Date(generatedAt)
    .toISOString()
    .slice(0, 16)
    .replace(/[-:]/g, "")
    .replace("T", "-");
  return `karakeep-retours-${stamp}.md`;
}
