import type { SourceKind } from "../archive/sources";

export type FetchStatus = "pending" | "running" | "success" | "error";
export type AiStatus =
  | "pending"
  | "running"
  | "success"
  | "error"
  | "skipped";
export type TagSource = "ai" | "human";

/** Ligne brute de la table `bookmarks`, telle que SQLite la rend. */
export interface BookmarkRow {
  id: string;
  url: string;
  title: string | null;
  description: string | null;
  content: string | null;
  author: string | null;
  site_name: string | null;
  image_url: string | null;
  favicon_url: string | null;
  published_at: number | null;
  note: string | null;
  created_at: number;
  updated_at: number;
  archived: number;
  favourited: number;
  fetch_status: FetchStatus;
  fetch_error: string | null;
  ai_status: AiStatus;
  ai_error: string | null;
  summary: string | null;
  subject: string | null;
  source_kind: SourceKind;
  theme_id: string | null;
  subtheme_id: string | null;
  theme_source: "ai" | "human" | null;
}

export interface Tag {
  id: string;
  name: string;
  source?: TagSource;
}

/** Favori tel que manipulé par l'interface. */
export interface Bookmark {
  id: string;
  url: string;
  title: string | null;
  description: string | null;
  content: string | null;
  author: string | null;
  siteName: string | null;
  imageUrl: string | null;
  faviconUrl: string | null;
  publishedAt: number | null;
  note: string | null;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  favourited: boolean;
  fetchStatus: FetchStatus;
  fetchError: string | null;
  aiStatus: AiStatus;
  aiError: string | null;
  summary: string | null;
  /** Ce que le modèle a compris du document, avant de le ranger. */
  subject: string | null;
  sourceKind: SourceKind;
  themeId: string | null;
  subthemeId: string | null;
  themeSource: "ai" | "human" | null;
  tags: Tag[];
}

export function rowToBookmark(row: BookmarkRow, tags: Tag[] = []): Bookmark {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    description: row.description,
    content: row.content,
    author: row.author,
    siteName: row.site_name,
    imageUrl: row.image_url,
    faviconUrl: row.favicon_url,
    publishedAt: row.published_at,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archived: row.archived === 1,
    favourited: row.favourited === 1,
    fetchStatus: row.fetch_status,
    fetchError: row.fetch_error,
    aiStatus: row.ai_status,
    aiError: row.ai_error,
    summary: row.summary,
    subject: row.subject,
    sourceKind: row.source_kind ?? "website",
    themeId: row.theme_id ?? null,
    subthemeId: row.subtheme_id ?? null,
    themeSource: row.theme_source ?? null,
    tags,
  };
}
