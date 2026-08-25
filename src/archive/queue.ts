import type { SourceKind } from "./sources";
import type { ArchiveResult } from "./types";

/**
 * File d'attente entre le code métier et la WebView d'archivage.
 *
 * Une WebView doit être montée dans l'arbre React pour exister : le pipeline ne
 * peut donc pas l'instancier à la demande. `WebArchiver` est monté une fois
 * dans la mise en page racine et consomme cette file ; `renderPage()` dépose
 * une demande et attend sa résolution.
 */

export interface ArchiveJob {
  id: number;
  url: string;
  /** Archive autonome demandée, ou simple rendu du DOM. */
  wantArchive: boolean;
  /** Capture d'écran demandée. */
  wantScreenshot: boolean;
  sourceKind: SourceKind;
  /** Attente supplémentaire avant extraction, selon la plateforme. */
  extraSettleMs: number;
  resolve: (result: ArchiveResult) => void;
  reject: (error: Error) => void;
}

let nextId = 1;
const pending: ArchiveJob[] = [];
let notifyWorker: (() => void) | null = null;

/** Délai maximal pour une page : rendu, extraction et intégration comprises. */
export const JOB_TIMEOUT_MS = 90_000;

export function enqueue(
  url: string,
  opts: {
    wantArchive: boolean;
    wantScreenshot: boolean;
    sourceKind: SourceKind;
    extraSettleMs: number;
  },
): Promise<ArchiveResult> {
  return new Promise<ArchiveResult>((resolve, reject) => {
    pending.push({
      id: nextId++,
      url,
      wantArchive: opts.wantArchive,
      wantScreenshot: opts.wantScreenshot,
      sourceKind: opts.sourceKind,
      extraSettleMs: opts.extraSettleMs,
      resolve,
      reject,
    });
    notifyWorker?.();
  });
}

export function takeNext(): ArchiveJob | undefined {
  return pending.shift();
}

export function hasPending(): boolean {
  return pending.length > 0;
}

/**
 * Enregistre la WebView. Sans elle, les demandes s'accumulent sans jamais être
 * traitées : le pipeline doit pouvoir le détecter.
 */
export function setWorker(notify: (() => void) | null): void {
  notifyWorker = notify;
}

export function isWorkerReady(): boolean {
  return notifyWorker !== null;
}

/** Vide la file en rejetant tout : utilisé si la WebView disparaît. */
export function drain(reason: string): void {
  while (pending.length > 0) {
    pending.shift()?.reject(new Error(reason));
  }
}
