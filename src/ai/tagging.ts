import type { Bookmark } from "../db/types";
import { frequentTagNames } from "../db/tags";
import { complete } from "./llm";
import {
  SYSTEM_PROMPT,
  TAGS_JSON_SCHEMA,
  buildTaggingPrompt,
  parseTagsResponse,
  sanitizeTags,
  type TagStyle,
} from "./prompt";

export interface TaggingOptions {
  modelPath: string;
  language: string;
  tagStyle: TagStyle;
  onLoadProgress?: (percent: number) => void;
}

/**
 * Génère les tags d'un favori avec le modèle embarqué.
 *
 * Remplace le worker `inference` de Karakeep : même rôle, mais l'inférence a
 * lieu sur l'appareil au lieu d'un appel à OpenAI ou Ollama.
 */
export async function generateTags(
  bookmark: Bookmark,
  opts: TaggingOptions,
): Promise<string[]> {
  // Sans titre ni contenu, il n'y a rien à analyser : mieux vaut ne rien
  // proposer que d'inventer des tags à partir d'une URL seule.
  if (!bookmark.title && !bookmark.description && !bookmark.content) {
    return [];
  }

  const existingTags = await frequentTagNames(30);

  const prompt = buildTaggingPrompt({
    title: bookmark.title,
    description: bookmark.description,
    content: bookmark.content,
    url: bookmark.url,
    language: opts.language,
    tagStyle: opts.tagStyle,
    existingTags,
  });

  const raw = await complete(
    opts.modelPath,
    {
      system: SYSTEM_PROMPT,
      prompt,
      jsonSchema: TAGS_JSON_SCHEMA,
      maxTokens: 200,
    },
    { onProgress: opts.onLoadProgress },
  );

  return sanitizeTags(parseTagsResponse(raw));
}
