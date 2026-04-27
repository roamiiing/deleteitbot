import { createDb, sqlitePathFromUrl } from "./client";
import { migrate as drizzleMigrate } from "drizzle-orm/bun-sqlite/migrator";

export function migrate(url = process.env.DATABASE_URL ?? "file:./data/deleteitbot.sqlite") {
  const { sqlite, db } = createDb(url);
  drizzleMigrate(db, { migrationsFolder: "./drizzle" });
  sqlite.close();
}

if (import.meta.main) {
  migrate();
  console.log(`SQLite migrations applied to ${sqlitePathFromUrl()}`);
}
