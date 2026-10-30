/** Minimal D1Database over node:sqlite: prepare/bind/first/run/all and batch. */
export async function sqliteD1() {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  const prepare = (sql: string) => {
    const make = (args: unknown[]) => ({
      sql,
      args,
      bind: (...a: unknown[]) => make(a),
      async first<T>() {
        return (db.prepare(sql).get(...(args as never[])) as T | undefined) ?? null;
      },
      async all<T>() {
        return { results: db.prepare(sql).all(...(args as never[])) as T[], success: true };
      },
      async run() {
        db.prepare(sql).run(...(args as never[]));
        return { success: true };
      },
    });
    return make([]);
  };
  const d1 = {
    prepare,
    async batch(stmts: { sql: string; args: unknown[] }[]) {
      db.exec("BEGIN");
      try {
        for (const s of stmts) db.prepare(s.sql).run(...(s.args as never[]));
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      return [];
    },
  };
  return { d1: d1 as unknown as D1Database, db };
}
