import * as Application from "expo-application";
import Constants from "expo-constants";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { Platform } from "react-native";

import { isNewer } from "./version";

/**
 * Recherche et installation des mises à jour depuis les releases GitHub.
 *
 * Le dépôt doit être public : l'application ne porte aucun jeton GitHub, et
 * embarquer un jeton dans une APK distribuée reviendrait à le publier.
 */

export interface ReleaseInfo {
  version: string;
  name: string;
  notes: string;
  publishedAt: string | null;
  apkUrl: string;
  apkSize: number;
  htmlUrl: string;
}

export type UpdateCheck =
  | { status: "up-to-date"; current: string }
  | { status: "available"; current: string; release: ReleaseInfo }
  | { status: "no-release"; current: string }
  | { status: "no-apk"; current: string; release: string };

export class UpdateError extends Error {
  constructor(
    message: string,
    readonly kind: "network" | "rate-limit" | "not-found" | "install",
  ) {
    super(message);
    this.name = "UpdateError";
  }
}

interface RepoRef {
  owner: string;
  repo: string;
}

function repoRef(): RepoRef {
  const configured = Constants.expoConfig?.extra?.updateRepo as
    | Partial<RepoRef>
    | undefined;
  const owner = configured?.owner;
  const repo = configured?.repo;
  if (!owner || !repo) {
    throw new UpdateError(
      "Dépôt de mise à jour non configuré (extra.updateRepo dans app.config.ts).",
      "not-found",
    );
  }
  return { owner, repo };
}

/** Version installée, telle qu'affichée dans les réglages. */
export function currentVersion(): string {
  return (
    Application.nativeApplicationVersion ??
    Constants.expoConfig?.version ??
    "0.0.0"
  );
}

export function currentBuild(): string {
  return Application.nativeBuildVersion ?? "?";
}

export function releasesUrl(): string {
  const { owner, repo } = repoRef();
  return `https://github.com/${owner}/${repo}/releases`;
}

interface GithubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface GithubRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  published_at: string | null;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
  assets: GithubAsset[];
}

/**
 * Interroge la dernière release publiée et compare à la version installée.
 */
export async function checkForUpdate(): Promise<UpdateCheck> {
  const { owner, repo } = repoRef();
  const current = currentVersion();

  let response: Response;
  try {
    response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/releases/latest`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
  } catch (err) {
    throw new UpdateError(
      `Impossible de joindre GitHub : ${(err as Error).message}`,
      "network",
    );
  }

  if (response.status === 404) {
    // Dépôt sans aucune release publiée : ce n'est pas une panne.
    return { status: "no-release", current };
  }
  if (response.status === 403 || response.status === 429) {
    throw new UpdateError(
      "Trop de requêtes vers GitHub. Réessaie dans quelques minutes.",
      "rate-limit",
    );
  }
  if (!response.ok) {
    throw new UpdateError(
      `GitHub a répondu ${response.status}.`,
      "network",
    );
  }

  const release = (await response.json()) as GithubRelease;
  const version = release.tag_name;

  if (!isNewer(version, current)) {
    return { status: "up-to-date", current };
  }

  const apk = release.assets.find((a) =>
    a.name.toLowerCase().endsWith(".apk"),
  );
  if (!apk) {
    // La release existe mais ne publie pas d'APK : rien à installer.
    return { status: "no-apk", current, release: version };
  }

  return {
    status: "available",
    current,
    release: {
      version,
      name: release.name ?? version,
      notes: release.body ?? "",
      publishedAt: release.published_at,
      apkUrl: apk.browser_download_url,
      apkSize: apk.size,
      htmlUrl: release.html_url,
    },
  };
}

export interface InstallProgress {
  ratio: number | null;
  written: number;
  total: number;
}

/**
 * Android 8 et suivants exigent une autorisation explicite, par application,
 * pour installer des APK. Sans elle, l'intent d'installation est refusé sans
 * message clair.
 */
export async function canInstallPackages(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  // L'API n'existe pas sur toutes les versions ; en cas de doute on laisse
  // tenter, le système affichera lui-même sa demande d'autorisation.
  const check = (
    Application as unknown as {
      canRequestPackageInstallsAsync?: () => Promise<boolean>;
    }
  ).canRequestPackageInstallsAsync;
  if (!check) return true;
  try {
    return await check();
  } catch {
    return true;
  }
}

/** Ouvre l'écran système d'autorisation d'installation pour cette application. */
export async function openInstallPermissionSettings(): Promise<void> {
  await IntentLauncher.startActivityAsync(
    IntentLauncher.ActivityAction.MANAGE_UNKNOWN_APP_SOURCES,
    { data: `package:${Application.applicationId}` },
  );
}

/**
 * Télécharge l'APK puis passe la main à l'installeur Android.
 *
 * L'installation elle-même est confirmée par l'utilisateur dans l'interface
 * système ; l'application ne peut pas — et ne doit pas — la valider seule.
 */
export async function downloadAndInstall(
  release: ReleaseInfo,
  onProgress: (p: InstallProgress) => void,
): Promise<void> {
  if (Platform.OS !== "android") {
    throw new UpdateError(
      "L'installation par APK n'existe que sur Android.",
      "install",
    );
  }

  const target = `${FileSystem.cacheDirectory}karakeep-local-${release.version}.apk`;

  // Un téléchargement précédent interrompu laisserait un fichier tronqué que
  // l'installeur rejetterait avec « paquet non valide ».
  await FileSystem.deleteAsync(target, { idempotent: true });

  const resumable = FileSystem.createDownloadResumable(
    release.apkUrl,
    target,
    {},
    ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
      const total =
        totalBytesExpectedToWrite > 0
          ? totalBytesExpectedToWrite
          : release.apkSize;
      onProgress({
        ratio: total > 0 ? totalBytesWritten / total : null,
        written: totalBytesWritten,
        total,
      });
    },
  );

  const result = await resumable.downloadAsync();
  if (!result) {
    throw new UpdateError("Téléchargement interrompu.", "network");
  }

  const info = await FileSystem.getInfoAsync(target);
  if (!info.exists || info.isDirectory || info.size === 0) {
    throw new UpdateError("Le fichier téléchargé est vide.", "network");
  }
  if (release.apkSize > 0 && info.size !== release.apkSize) {
    await FileSystem.deleteAsync(target, { idempotent: true });
    throw new UpdateError(
      `Téléchargement incomplet (${info.size} octets sur ${release.apkSize}).`,
      "network",
    );
  }

  // L'installeur est un autre processus : il ne peut pas lire un file:// privé
  // à l'application. Le FileProvider d'Expo expose le fichier en content://.
  const contentUri = await FileSystem.getContentUriAsync(target);

  await IntentLauncher.startActivityAsync(
    "android.intent.action.INSTALL_PACKAGE",
    {
      data: contentUri,
      flags:
        // FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK
        1 | 268435456,
      type: "application/vnd.android.package-archive",
    },
  );
}
