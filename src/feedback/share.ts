import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

import { allReviews, markExported, unexportedReviews } from "../db/reviews";
import { appVersion } from "./collect";
import { buildFeedbackMarkdown, feedbackFileName, hasOpinion } from "./format";

/**
 * Sortie des retours vers l'extérieur.
 *
 * Le fichier part dans le cache : il n'a pas à survivre au partage, et c'est
 * le répertoire que le fournisseur de fichiers d'Android sait exposer aux
 * autres applications.
 */

export interface ExportResult {
  /** Nombre d'avis effectivement transmis. */
  count: number;
  fileName: string;
}

export class NothingToExportError extends Error {
  constructor() {
    super(
      "Aucun avis à transmettre. Juge d'abord quelques propositions depuis " +
        "l'écran de relecture.",
    );
    this.name = "NothingToExportError";
  }
}

/**
 * Écrit et partage les retours.
 *
 * `all` renvoie tout l'historique plutôt que les seuls avis non transmis :
 * utile si un export s'est perdu en route.
 */
export async function exportReviews(
  { all = false }: { all?: boolean } = {},
): Promise<ExportResult> {
  const entries = (all ? await allReviews() : await unexportedReviews()).filter(
    hasOpinion,
  );
  if (entries.length === 0) throw new NothingToExportError();

  const generatedAt = Date.now();
  const markdown = buildFeedbackMarkdown(entries, {
    appVersion: appVersion(),
    generatedAt,
  });

  const fileName = feedbackFileName(generatedAt);
  const path = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(path, markdown, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error(
      `Le partage n'est pas disponible sur cet appareil. Le fichier a été écrit ici : ${path}`,
    );
  }

  await Sharing.shareAsync(path, {
    mimeType: "text/markdown",
    dialogTitle: "Transmettre les retours",
    UTI: "net.daringfireball.markdown",
  });

  // Marqué seulement après le partage : marquer avant perdrait les retours si
  // l'utilisateur referme la feuille de partage.
  await markExported(entries.map((e) => e.id));

  return { count: entries.length, fileName };
}
