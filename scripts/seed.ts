import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "path";
import { fileURLToPath } from "url";
import * as schema from "../app/db/schema";
import { seedDatabase, DROP_OFF_CLIFFS } from "./seed-data";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsFolder = path.resolve(__dirname, "../drizzle");

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

const db = drizzle(sqlite, { schema });

function seed() {
  console.log("Seeding database...");

  // Drop and recreate tables for a clean seed
  sqlite.exec(`
    DROP TABLE IF EXISTS comments;
    DROP TABLE IF EXISTS course_ratings;
    DROP TABLE IF EXISTS video_watch_events;
    DROP TABLE IF EXISTS quiz_answers;
    DROP TABLE IF EXISTS quiz_attempts;
    DROP TABLE IF EXISTS quiz_options;
    DROP TABLE IF EXISTS quiz_questions;
    DROP TABLE IF EXISTS quizzes;
    DROP TABLE IF EXISTS lesson_progress;
    DROP TABLE IF EXISTS coupons;
    DROP TABLE IF EXISTS team_members;
    DROP TABLE IF EXISTS teams;
    DROP TABLE IF EXISTS purchases;
    DROP TABLE IF EXISTS enrollments;
    DROP TABLE IF EXISTS lessons;
    DROP TABLE IF EXISTS modules;
    DROP TABLE IF EXISTS courses;
    DROP TABLE IF EXISTS categories;
    DROP TABLE IF EXISTS users;
    DROP TABLE IF EXISTS __drizzle_migrations;
  `);

  // Create tables using the same Drizzle migrations as the live database
  migrate(db, { migrationsFolder });

  console.log("Tables created.");

  const summary = seedDatabase(db);

  console.log("\n✓ Seed complete!");
  for (const [table, count] of Object.entries(summary.rowCounts)) {
    console.log(`  ${table}: ${count}`);
  }
  const roles = Object.entries(summary.usersByRole)
    .map(([role, count]) => `${count} ${role}`)
    .join(", ");
  console.log(`  Users by role: ${roles}`);
  console.log(
    `  Team coupons: ${summary.coupons.redeemed} redeemed, ${summary.coupons.available} available`
  );
  console.log("  Planted drop-off cliffs (the funnel should fall sharply here):");
  for (const { courseSlug, lessonTitle } of DROP_OFF_CLIFFS) {
    console.log(`    ${courseSlug} → "${lessonTitle}"`);
  }
}

seed();
