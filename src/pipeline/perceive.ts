import * as FileSystem from "expo-file-system/legacy";

import { complete } from "../ai/llm";
import { modelPathFor, isModelInstalled } from "../ai/download";
import { projectorDescriptor, type ModelDescriptor } from "../ai/models";
import {
  MAX_AUDIO_SECONDS,
  MAX_FRAMES,
  MAX_IMAGES,
  PERCEIVE_SYSTEM_PROMPT,
  buildPerceivePrompt,
  parsePerception,
} from "../ai/perception";
import { listAssets } from "../db/assets";
import { getDb } from "../db/client";
import { extractAudio, extractFrames } from "../../modules/karakeep-worker/src";

/** Le modèle peut-il regarder et écouter, et son projecteur est-il là ? */
export async function canPerceive(model: ModelDescriptor): Promise<string | null> {
  const projector = projectorDescriptor(model);
  if (!projector || !model.senses?.length) return null;
  return (await isModelInstalled(projector)) ? modelPathFor(projector) : null;
}

async function readDescription(id: string): Promise<string | null | undefined> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ d: string | null }>(
    "SELECT media_description AS d FROM bookmarks WHERE id = ?",
    [id],
  );
  if (!row) return undefined;
  return row.d === null ? undefined : row.d;
}

async function saveDescription(id: string, text: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE bookmarks SET media_description = ? WHERE id = ?", [text, id]);
}

/**
 * Description des médias d'une fiche, calculée une fois (voir
 * `ai/perception.ts`). `null` quand le modèle ne sait pas regarder : la
 * fiche sera reprise quand il le saura.
 */
export async function ensurePerception(
  bookmark: { id: string; content: string | null; description: string | null },
  model: ModelDescriptor,
  timeoutMs: number,
): Promise<string | null> {
  const known = await readDescription(bookmark.id);
  if (known !== undefined) return known;
  const projectorPath = await canPerceive(model);
  if (!projectorPath) return null;

  const assets = await listAssets(bookmark.id);
  const images = assets.filter((a) => a.kind === "image").slice(0, MAX_IMAGES).map((a) => a.path);
  const video = assets.find((a) => a.kind === "video");
  const work = `${FileSystem.cacheDirectory}perception/${bookmark.id}/`;
  let frames: string[] = [];
  let audio: string | null = null;
  if (video) {
    const path = video.path.replace(/^file:\/\//, "");
    const dir = work.replace(/^file:\/\//, "");
    frames = await extractFrames(path, MAX_FRAMES, dir).catch(() => []);
    if (model.senses?.includes("audio")) {
      audio = await extractAudio(path, `${dir}audio.wav`, MAX_AUDIO_SECONDS).catch(() => null);
    }
  }
  if (images.length === 0 && frames.length === 0 && !audio) {
    await saveDescription(bookmark.id, "");
    return "";
  }

  try {
    const raw = await complete(
      modelPathFor(model),
      {
        system: PERCEIVE_SYSTEM_PROMPT,
        prompt: buildPerceivePrompt({
          caption: bookmark.description ?? bookmark.content,
          images: images.length,
          frames: frames.length,
          audio: !!audio,
        }),
        images: [...images, ...frames],
        audio,
        maxTokens: 320,
        timeoutMs,
      },
      { projectorPath },
    );
    const text = parsePerception(raw) ?? "";
    await saveDescription(bookmark.id, text);
    return text;
  } catch (err) {
    // Trop long pour ce téléphone : on n'y revient pas à chaque nuit, ce qui
    // coûterait six minutes par lien pour le même résultat. Le lien est
    // rangé d'après sa légende et le texte de ses images.
    if ((err as Error).name === "InferenceTimeoutError") await saveDescription(bookmark.id, "");
    throw err;
  } finally {
    await FileSystem.deleteAsync(work, { idempotent: true }).catch(() => {});
  }
}

/** Une nouvelle capture remplace les médias : leur description est à refaire. */
export async function resetPerception(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE bookmarks SET media_description = NULL WHERE id = ?", [id]);
}
