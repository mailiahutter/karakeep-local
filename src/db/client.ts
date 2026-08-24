import * as SQLite from "expo-sqlite";

import { MIGRATIONS } from "./migrations";

const DB_NAME = "karakeep-local.db";

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function openAndMigrate(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);

  // WAL : les écritures d'arrière-plan (extraction, tagging) ne bloquent pas
  // les lectures de l'interface.
  await db.execAsync("PRAGMA journal_mode = WAL;");
  await db.execAsync("PRAGMA foreign_keys = ON;");

  const row = await db.getFirstAsync<{ user_version: number }>(
    "PRAGMA user_version",
  );
  const current = row?.user_version ?? 0;

  for (let i = current; i < MIGRATIONS.length; i++) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(MIGRATIONS[i]);
    });
    // PRAGMA n'accepte pas de paramètre lié ; l'indice vient d'une boucle sur un
    // tableau littéral, il n'y a pas d'entrée utilisateur ici.
    await db.execAsync(`PRAGMA user_version = ${i + 1}`);
  }

  return db;
}

/**
 * Accès à la base. La promesse est mémorisée pour que les migrations ne
 * s'exécutent qu'une fois, même si plusieurs écrans appellent en parallèle au
 * démarrage.
 */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= openAndMigrate().catch((err) => {
    // Sans cette remise à zéro, un échec transitoire condamnerait la base pour
    // toute la durée de vie du processus.
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}
