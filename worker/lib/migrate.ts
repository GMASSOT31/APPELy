import m0001 from '../migrations/0001_acces_ecoles'
import m0002 from '../migrations/0002_classes_eleves'

/**
 * Migrations versionnées, appliquées au premier appel d'API de chaque instance.
 * On évite ainsi de donner au jeton de build Cloudflare des droits sur la base.
 * Chaque migration est appliquée dans un seul lot transactionnel D1, avec son
 * enregistrement dans `schema_migrations` : elle passe entièrement ou pas du tout.
 */
export const MIGRATIONS: { id: string; sql: string }[] = [
  { id: '0001_acces_ecoles', sql: m0001 },
  { id: '0002_classes_eleves', sql: m0002 },
]

/** Découpe un script SQL en instructions (pas de « ; » dans nos chaînes ni nos triggers). */
export function splitStatements(sql: string): string[] {
  return sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
}

const migrated = new WeakMap<D1Database, Promise<void>>()

export function ensureMigrated(db: D1Database): Promise<void> {
  let p = migrated.get(db)
  if (!p) {
    p = runMigrations(db).catch((e) => {
      migrated.delete(db)
      throw e
    })
    migrated.set(db, p)
  }
  return p
}

async function runMigrations(db: D1Database) {
  await db.prepare('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)').run()
  const { results } = await db.prepare('SELECT id FROM schema_migrations').all<{ id: string }>()
  const done = new Set(results.map((r) => r.id))
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue
    const stmts = splitStatements(m.sql).map((s) => db.prepare(s))
    stmts.push(
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').bind(m.id, new Date().toISOString()),
    )
    try {
      await db.batch(stmts)
    } catch (e) {
      // Une autre instance a pu appliquer la migration en parallèle.
      const again = await db.prepare('SELECT id FROM schema_migrations WHERE id = ?').bind(m.id).first()
      if (!again) throw e
    }
  }
}
