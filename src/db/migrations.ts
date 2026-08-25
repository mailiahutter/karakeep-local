/**
 * Migrations du schéma local.
 *
 * Chaque entrée est appliquée dans l'ordre, une seule fois, et `PRAGMA
 * user_version` mémorise l'indice atteint. Ne jamais modifier une migration
 * déjà publiée : en ajouter une nouvelle à la suite.
 */
export const MIGRATIONS: string[] = [
  // 001 — tables de base + index plein texte.
  `
  CREATE TABLE bookmarks (
    id            TEXT PRIMARY KEY NOT NULL,
    url           TEXT NOT NULL,
    title         TEXT,
    description   TEXT,
    content       TEXT,
    author        TEXT,
    site_name     TEXT,
    image_url     TEXT,
    favicon_url   TEXT,
    published_at  INTEGER,
    note          TEXT,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    archived      INTEGER NOT NULL DEFAULT 0,
    favourited    INTEGER NOT NULL DEFAULT 0,
    -- pending | running | success | error : état de l'extraction du contenu
    fetch_status  TEXT NOT NULL DEFAULT 'pending',
    fetch_error   TEXT,
    -- pending | running | success | error | skipped : état du tagging IA
    ai_status     TEXT NOT NULL DEFAULT 'pending',
    ai_error      TEXT
  );

  CREATE UNIQUE INDEX idx_bookmarks_url ON bookmarks(url);
  CREATE INDEX idx_bookmarks_created ON bookmarks(created_at DESC);
  CREATE INDEX idx_bookmarks_archived ON bookmarks(archived, created_at DESC);
  CREATE INDEX idx_bookmarks_fetch_status ON bookmarks(fetch_status);
  CREATE INDEX idx_bookmarks_ai_status ON bookmarks(ai_status);

  CREATE TABLE tags (
    id         TEXT PRIMARY KEY NOT NULL,
    name       TEXT NOT NULL COLLATE NOCASE,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX idx_tags_name ON tags(name COLLATE NOCASE);

  CREATE TABLE bookmark_tags (
    bookmark_id TEXT NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
    tag_id      TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    -- 'ai' si proposé par le modèle, 'human' si ajouté à la main
    source      TEXT NOT NULL DEFAULT 'human',
    PRIMARY KEY (bookmark_id, tag_id)
  );
  CREATE INDEX idx_bookmark_tags_tag ON bookmark_tags(tag_id);

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );

  -- Table autonome (pas de content='bookmarks') : l'identifiant des favoris est
  -- un TEXT, il ne peut pas servir de rowid à une table FTS à contenu externe.
  CREATE VIRTUAL TABLE bookmarks_fts USING fts5(
    bookmark_id UNINDEXED,
    title,
    description,
    content,
    url,
    tokenize = 'unicode61 remove_diacritics 2'
  );

  -- Synchronisation par déclencheurs : aucun chemin d'écriture ne peut
  -- désynchroniser l'index, même en cas d'oubli côté application.
  CREATE TRIGGER bookmarks_fts_insert AFTER INSERT ON bookmarks BEGIN
    INSERT INTO bookmarks_fts(bookmark_id, title, description, content, url)
    VALUES (new.id, new.title, new.description, new.content, new.url);
  END;

  CREATE TRIGGER bookmarks_fts_delete AFTER DELETE ON bookmarks BEGIN
    DELETE FROM bookmarks_fts WHERE bookmark_id = old.id;
  END;

  CREATE TRIGGER bookmarks_fts_update AFTER UPDATE ON bookmarks BEGIN
    DELETE FROM bookmarks_fts WHERE bookmark_id = old.id;
    INSERT INTO bookmarks_fts(bookmark_id, title, description, content, url)
    VALUES (new.id, new.title, new.description, new.content, new.url);
  END;
  `,

  // 002 — pièces conservées, résumé généré, nature de la source.
  `
  CREATE TABLE assets (
    id          TEXT PRIMARY KEY NOT NULL,
    bookmark_id TEXT NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
    -- screenshot | pdf | archive | image | video
    kind        TEXT NOT NULL,
    path        TEXT NOT NULL,
    bytes       INTEGER NOT NULL DEFAULT 0,
    source_url  TEXT,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX idx_assets_bookmark ON assets(bookmark_id);

  ALTER TABLE bookmarks ADD COLUMN summary TEXT;
  -- website | youtube | instagram : conditionne l'extraction appliquée.
  ALTER TABLE bookmarks ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'website';

  -- Le résumé doit être trouvable par la recherche au même titre que le texte.
  DROP TRIGGER bookmarks_fts_insert;
  DROP TRIGGER bookmarks_fts_update;

  CREATE TRIGGER bookmarks_fts_insert AFTER INSERT ON bookmarks BEGIN
    INSERT INTO bookmarks_fts(bookmark_id, title, description, content, url)
    VALUES (new.id, new.title,
            COALESCE(new.description, '') || ' ' || COALESCE(new.summary, ''),
            new.content, new.url);
  END;

  CREATE TRIGGER bookmarks_fts_update AFTER UPDATE ON bookmarks BEGIN
    DELETE FROM bookmarks_fts WHERE bookmark_id = old.id;
    INSERT INTO bookmarks_fts(bookmark_id, title, description, content, url)
    VALUES (new.id, new.title,
            COALESCE(new.description, '') || ' ' || COALESCE(new.summary, ''),
            new.content, new.url);
  END;

  -- Réindexe l'existant : les favoris déjà enregistrés doivent rester
  -- trouvables après le changement de déclencheurs.
  DELETE FROM bookmarks_fts;
  INSERT INTO bookmarks_fts(bookmark_id, title, description, content, url)
  SELECT id, title, COALESCE(description, ''), content, url FROM bookmarks;
  `,
];
