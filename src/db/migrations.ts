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

  // 003 — rangement par thème et sous-thème.
  //
  // Le tagging libre demandait au modèle d'inventer des mots ; le classement
  // lui demande de choisir dans une liste fermée. C'est incomparablement plus
  // fiable pour un petit modèle, et c'est ce qui correspond à l'usage :
  // retrouver « une idée d'aménagement de van », pas « un tag vanlife ».
  `
  CREATE TABLE themes (
    id       TEXT PRIMARY KEY NOT NULL,
    name     TEXT NOT NULL,
    icon     TEXT,
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE UNIQUE INDEX idx_themes_name ON themes(name COLLATE NOCASE);

  CREATE TABLE subthemes (
    id       TEXT PRIMARY KEY NOT NULL,
    theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
    name     TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_subthemes_theme ON subthemes(theme_id, position);
  CREATE UNIQUE INDEX idx_subthemes_name ON subthemes(theme_id, name COLLATE NOCASE);

  ALTER TABLE bookmarks ADD COLUMN theme_id TEXT REFERENCES themes(id) ON DELETE SET NULL;
  ALTER TABLE bookmarks ADD COLUMN subtheme_id TEXT REFERENCES subthemes(id) ON DELETE SET NULL;
  -- 'ai' si proposé par le modèle, 'human' si corrigé à la main : une
  -- correction manuelle ne doit jamais être écrasée par un reclassement.
  ALTER TABLE bookmarks ADD COLUMN theme_source TEXT;
  CREATE INDEX idx_bookmarks_theme ON bookmarks(theme_id, subtheme_id);
  `,

  // 004 — description des thèmes, écrite pour le modèle.
  //
  // Un intitulé seul est ambigu : « Moto › Ma sélection » ne dit pas au modèle
  // s'il s'agit de motos à acheter ou d'itinéraires. La description est la
  // consigne de rangement que l'utilisateur donne au modèle, dans ses propres
  // mots ; elle est reprise telle quelle dans la liste des catégories.
  `
  ALTER TABLE themes    ADD COLUMN description TEXT;
  ALTER TABLE subthemes ADD COLUMN description TEXT;

  -- Rattrapage des arborescences déjà semées : sans cela, un utilisateur
  -- installé avant cette version resterait avec des catégories muettes, donc
  -- un classement à l'aveugle. Le texte est figé ici, volontairement dupliqué
  -- depuis DEFAULT_THEMES : une migration ne doit jamais dépendre de code qui
  -- change. Seules les lignes sans description sont touchées.
  UPDATE themes SET description = 'Recettes de cuisine et idées de plats à refaire.'
    WHERE name = 'Recettes' AND description IS NULL;
  UPDATE subthemes SET description = 'Recettes à base de viande : bœuf, porc, volaille, agneau.'
    WHERE name = 'Viande' AND description IS NULL;
  UPDATE subthemes SET description = 'Recettes légères et équilibrées, riches en légumes.'
    WHERE name = 'Healthy' AND description IS NULL;
  UPDATE subthemes SET description = 'Recettes riches en protéines, pour la prise de muscle.'
    WHERE name = 'Plats protéinés' AND description IS NULL;
  UPDATE subthemes SET description = 'Recettes pauvres en calories, pour la sèche.'
    WHERE name = 'Perte de graisse' AND description IS NULL;
  UPDATE subthemes SET description = 'Desserts, pâtisseries, goûters et boissons sucrées.'
    WHERE name = 'Desserts' AND description IS NULL;
  UPDATE themes SET description = 'Endroits où partir en voyage sur la route.'
    WHERE name = 'Destinations roadtrip' AND description IS NULL;
  UPDATE subthemes SET description = 'Itinéraires et destinations à faire à moto.'
    WHERE name = 'Roadtrip moto' AND description IS NULL;
  UPDATE subthemes SET description = 'Itinéraires et destinations à faire en van ou en fourgon.'
    WHERE name = 'Roadtrip van aménagé' AND description IS NULL;
  UPDATE subthemes SET description = 'Lieux précis où dormir, se garer ou bivouaquer.'
    WHERE name = 'Spots et bivouacs' AND description IS NULL;
  UPDATE themes SET description = 'La moto en tant que machine : modèles, pièces, équipement.'
    WHERE name = 'Moto' AND description IS NULL;
  UPDATE subthemes SET description = 'Modèles de motos qui me plaisent ou que j''envisage d''acheter.'
    WHERE name = 'Ma sélection de motos' AND description IS NULL;
  UPDATE subthemes SET description = 'Modifications, préparation et personnalisation d''une moto.'
    WHERE name = 'Tuning moto' AND description IS NULL;
  UPDATE subthemes SET description = 'Casques, gants, blousons, bagagerie et accessoires du pilote.'
    WHERE name = 'Équipement' AND description IS NULL;
  UPDATE themes SET description = 'Vivre et voyager en van aménagé : le véhicule et son aménagement.'
    WHERE name = 'Vanlife' AND description IS NULL;
  UPDATE subthemes SET description = 'Plans, agencements et astuces pour aménager l''intérieur d''un van.'
    WHERE name = 'Idées d''aménagement' AND description IS NULL;
  UPDATE subthemes SET description = 'Produits précis à acheter pour un van : batterie, frigo, chauffage.'
    WHERE name = 'Produits et matériel' AND description IS NULL;
  UPDATE subthemes SET description = 'Entreprises et artisans qui vendent ou aménagent des vans.'
    WHERE name = 'Fournisseurs de van aménagé' AND description IS NULL;
  UPDATE themes SET description = 'La voiture : entretien, réparations, améliorations, modèles.'
    WHERE name = 'Voiture' AND description IS NULL;
  UPDATE subthemes SET description = 'Modifications et accessoires pour améliorer une voiture.'
    WHERE name = 'Améliorations' AND description IS NULL;
  UPDATE subthemes SET description = 'Tutoriels de réparation, entretien, pièces à changer.'
    WHERE name = 'Entretien et réparation' AND description IS NULL;
  UPDATE subthemes SET description = 'Modèles de voitures que j''envisage d''acheter.'
    WHERE name = 'Modèles visés' AND description IS NULL;
  UPDATE themes SET description = 'La maison : construction, architecture, aménagement, travaux.'
    WHERE name = 'Maison' AND description IS NULL;
  UPDATE subthemes SET description = 'Idées d''architecture, plans et styles de maisons.'
    WHERE name = 'Architecture' AND description IS NULL;
  UPDATE subthemes SET description = 'Décoration, mobilier et agencement des pièces.'
    WHERE name = 'Aménagement intérieur' AND description IS NULL;
  UPDATE subthemes SET description = 'Terrasse, jardin, piscine, clôtures et extérieurs.'
    WHERE name = 'Extérieur et jardin' AND description IS NULL;
  UPDATE subthemes SET description = 'Tutoriels de travaux, bricolage et rénovation.'
    WHERE name = 'Travaux et bricolage' AND description IS NULL;
  `,

  // 005 — icônes emoji.
  //
  // Le jeu d'icônes vectorielles n'avait ni animaux, ni tente, ni la moitié de
  // ce que l'on range : le clavier emoji est déjà complet. Les thèmes d'origine
  // basculent, à condition d'avoir gardé leur icône : une icône changée à la
  // main ne correspond plus à la valeur testée, et reste donc intacte.
  `
  UPDATE themes SET icon = '🍽️' WHERE name = 'Recettes' AND icon = 'restaurant-outline';
  UPDATE themes SET icon = '🗺️' WHERE name = 'Destinations roadtrip' AND icon = 'map-outline';
  UPDATE themes SET icon = '🏍️' WHERE name = 'Moto' AND icon = 'bicycle-outline';
  UPDATE themes SET icon = '🚐' WHERE name = 'Vanlife' AND icon = 'bus-outline';
  UPDATE themes SET icon = '🚗' WHERE name = 'Voiture' AND icon = 'car-sport-outline';
  UPDATE themes SET icon = '🏠' WHERE name = 'Maison' AND icon = 'home-outline';
  `,

  // 006 — avis sur les propositions du modèle.
  //
  // L'application ne peut s'améliorer que si l'on sait où elle se trompe.
  // Chaque avis fige ce que le modèle avait proposé au moment du jugement :
  // sans cette copie, une correction faite ensuite rendrait l'avis
  // incompréhensible à la relecture.
  //
  // Pas de clé étrangère vers `bookmarks` : l'avis porte sur le comportement
  // du modèle, pas sur le lien. Supprimer un favori ne doit pas effacer un
  // retour qui n'a pas encore été transmis.
  `
  CREATE TABLE reviews (
    id              TEXT PRIMARY KEY NOT NULL,
    bookmark_id     TEXT NOT NULL,
    created_at      INTEGER NOT NULL,
    -- 'good' | 'bad' | NULL (sans avis), pour chacun des quatre aspects
    theme_verdict   TEXT,
    tags_verdict    TEXT,
    media_verdict   TEXT,
    summary_verdict TEXT,
    comment         TEXT,
    -- Copie JSON de ce que le modèle avait proposé.
    snapshot        TEXT NOT NULL,
    exported_at     INTEGER
  );
  CREATE UNIQUE INDEX idx_reviews_bookmark ON reviews(bookmark_id);
  CREATE INDEX idx_reviews_export ON reviews(exported_at, created_at);
  `,

  // 007 — ce que le modèle a compris du document.
  //
  // Un mauvais rangement a deux causes possibles : le modèle n'a pas compris
  // le sujet, ou il l'a compris et a mal choisi. Sans garder sa lecture, on ne
  // peut pas les distinguer — et donc pas savoir quoi corriger.
  `
  ALTER TABLE bookmarks ADD COLUMN subject TEXT;
  `,

  // 008 — remise en file après le changement d'analyse.
  //
  // Les tags ne sont plus les hashtags bruts de la publication mais les
  // mots-clés du modèle, dans une seule langue ; le rangement descend
  // l'arborescence au lieu de choisir dans une liste à plat. Les fiches
  // analysées par les versions précédentes portent donc des propositions qui
  // n'ont plus le même sens — jusqu'à vingt-neuf tags en trois langues.
  //
  // Elles repassent une fois au modèle. Ce que l'utilisateur a rangé lui-même
  // est épargné : `theme_source = 'human'` n'est jamais défait.
  `
  UPDATE bookmarks SET ai_status = 'pending'
   WHERE archived = 0
     AND ai_status IN ('success', 'error')
     AND (theme_source IS NULL OR theme_source <> 'human');
  `,

  // 009 — mode de capture.
  //
  // Hors interface, la page est lue sans moteur de rendu : ni capture d'écran
  // ni archive autonome. La fiche reste exploitable — c'est tout l'intérêt —
  // mais incomplète. On le note pour la compléter à la prochaine ouverture,
  // plutôt que de la laisser diminuée pour toujours.
  `
  ALTER TABLE bookmarks ADD COLUMN capture_mode TEXT;
  CREATE INDEX idx_bookmarks_capture_mode ON bookmarks(capture_mode);
  `,

  // 010 — nombre de tentatives d'extraction.
  //
  // Une séance de nuit en mode avion faisait échouer toutes les captures, et
  // les marquait en erreur définitive : une nuit suffisait à griller la file
  // entière. Une panne de réseau doit laisser le lien en attente, pas le
  // condamner — mais sans compteur, un lien réellement mort serait repris
  // indéfiniment.
  `
  ALTER TABLE bookmarks ADD COLUMN fetch_attempts INTEGER NOT NULL DEFAULT 0;
  `,

  // 011 — tout reprendre.
  //
  // Beaucoup de fiches étaient restées en plan : extraction en erreur après
  // une nuit sans réseau, analyse jamais lancée, fiche vide, rangement absent.
  // Les publications Instagram repassent toutes une fois : la nouvelle
  // méthode (reprise de Cobalt) récupère chaque photo du carrousel et la vidéo
  // en pleine qualité, là où l'ancienne devinait à partir de la page.
  //
  // Copie figée des requêtes de \`requeue.sql.ts\` : une migration ne doit plus
  // changer une fois publiée, même si le bouton « Tout relancer » évolue.
  `
  UPDATE bookmarks
     SET fetch_status = 'pending', fetch_attempts = 0, fetch_error = NULL
   WHERE archived = 0
     AND (
       fetch_status IN ('error', 'running')
       OR source_kind = 'instagram'
       OR (fetch_status = 'success'
           AND (content IS NULL OR trim(content) = '')
           AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.bookmark_id = bookmarks.id))
     );
  UPDATE bookmarks
     SET ai_status = 'pending', ai_error = NULL
   WHERE archived = 0
     AND (
       fetch_status = 'pending'
       OR ai_status IN ('error', 'skipped', 'running')
       OR (ai_status = 'success'
           AND (theme_id IS NULL
                OR summary IS NULL OR trim(summary) = ''
                OR subject IS NULL OR trim(subject) = ''))
     );
  `,

  // 012 — version 3.0.
  //
  // - `embeddings` : vecteurs de sens du petit modèle de proximité, mis en
  //   cache. Calculer celui d'un thème ou d'un exemple à chaque lien
  //   coûterait plus que l'analyse elle-même. `hash` dit sur quel texte il a
  //   été calculé : un thème renommé ou redécrit est recalculé.
  // - `ocr_text` : le texte lu dans les images. NULL tant que la lecture n'a
  //   pas eu lieu, chaîne vide quand elle n'a rien trouvé.
  // - `next_fetch_at`, `retry_days` et `source_gone` : un lien qui ne répond pas est
  //   réessayé le lendemain plutôt que condamné ; au bout de plusieurs jours,
  //   la source est déclarée disparue — ce qui a été sauvegardé reste.
  // - `analysed_at` : date de la dernière analyse réussie, pour le bilan de
  //   la nuit.
  // - `highlights` : passages surlignés, avec une note facultative.
  `
  CREATE TABLE embeddings (
    key        TEXT PRIMARY KEY NOT NULL,
    model      TEXT NOT NULL,
    hash       TEXT NOT NULL,
    vector     TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  ALTER TABLE bookmarks ADD COLUMN ocr_text TEXT;
  ALTER TABLE bookmarks ADD COLUMN next_fetch_at INTEGER;
  ALTER TABLE bookmarks ADD COLUMN source_gone INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE bookmarks ADD COLUMN retry_days INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE bookmarks ADD COLUMN analysed_at INTEGER;
  UPDATE bookmarks SET analysed_at = updated_at WHERE ai_status = 'success';
  CREATE INDEX idx_bookmarks_analysed ON bookmarks(analysed_at);

  CREATE TABLE highlights (
    id          TEXT PRIMARY KEY NOT NULL,
    bookmark_id TEXT NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
    text        TEXT NOT NULL,
    note        TEXT,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX idx_highlights_bookmark ON highlights(bookmark_id, position);
  `,

  // 013 — version 3.1 : le design « Tiroirs » validé au tour 2.
  //
  // - `ai_confidence` et `ai_alternatives` : la certitude réelle du modèle
  //   sur le tiroir retenu, et les autres tiroirs envisagés. C'est elle qui
  //   décide de ce que l'utilisateur doit vérifier le matin.
  // - `theme_suggestion` : le tiroir que l'IA propose de créer quand aucun ne
  //   convient (JSON : nom, emoji, description).
  // - `verified_at` : vérifié par l'utilisateur — ne plus le lui reproposer.
  // - `themes.cover_bookmark_id` : la photo de couverture choisie pour un
  //   tiroir ; sans choix, celle de l'idée la plus récente.
  // - `reminders` : « jette un œil à cette idée tel jour à telle heure ».
  //
  // Les rangements faits par l'IA avant cette version n'ont pas de certitude
  // mesurée : ils repassent une fois au modèle pour l'obtenir.
  `
  ALTER TABLE bookmarks ADD COLUMN ai_confidence REAL;
  ALTER TABLE bookmarks ADD COLUMN ai_alternatives TEXT;
  ALTER TABLE bookmarks ADD COLUMN theme_suggestion TEXT;
  ALTER TABLE bookmarks ADD COLUMN verified_at INTEGER;
  ALTER TABLE themes ADD COLUMN cover_bookmark_id TEXT;

  CREATE TABLE reminders (
    id              TEXT PRIMARY KEY NOT NULL,
    bookmark_id     TEXT NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
    due_at          INTEGER NOT NULL,
    notification_id TEXT,
    done            INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL
  );
  CREATE INDEX idx_reminders_due ON reminders(done, due_at);

  UPDATE bookmarks SET ai_status = 'pending'
   WHERE archived = 0
     AND ai_status = 'success'
     AND (theme_source IS NULL OR theme_source <> 'human');
  `,
];
