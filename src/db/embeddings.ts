import { getDb } from "./client";

/** Vecteur mis en cache, s'il a été calculé sur le même texte. */
export async function readEmbedding(key: string, hash: string): Promise<number[] | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ vector: string }>(
    "SELECT vector FROM embeddings WHERE key = ? AND hash = ?",
    [key, hash],
  );
  if (!row) return null;
  try {
    const v = JSON.parse(row.vector);
    return Array.isArray(v) ? (v as number[]) : null;
  } catch {
    return null;
  }
}

export async function writeEmbedding(
  key: string,
  model: string,
  hash: string,
  vector: number[],
): Promise<void> {
  const db = await getDb();
  // Quatre décimales suffisent largement à comparer des sens, et divisent la
  // place occupée par trois.
  const compact = JSON.stringify(vector.map((x) => Math.round(x * 1e4) / 1e4));
  await db.runAsync(
    `INSERT INTO embeddings (key, model, hash, vector, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET model = excluded.model, hash = excluded.hash,
       vector = excluded.vector, created_at = excluded.created_at`,
    [key, model, hash, compact, Date.now()],
  );
}
