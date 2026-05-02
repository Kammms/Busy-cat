import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./db";
import path from "path";

export async function runMigrations() {
  console.log("Running database migrations...");
  try {
    await migrate(db, { migrationsFolder: path.join(process.cwd(), "migrations") });
    console.log("Database migrations complete.");
  } catch (err) {
    console.error("Migration failed:", err);
    throw err;
  } finally {
    // Don't close the pool — it's shared with the rest of the app
  }
}
