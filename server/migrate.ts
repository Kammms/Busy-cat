import { pool } from "./db";

export async function runMigrations() {
  console.log("Initializing database schema...");
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "moderators" (
        "id" serial PRIMARY KEY NOT NULL,
        "discord_id" text NOT NULL UNIQUE,
        "username" text NOT NULL,
        "avatar" text,
        "is_ignored" boolean DEFAULT false NOT NULL,
        "message_count" integer DEFAULT 0 NOT NULL,
        "invite_count" integer DEFAULT 0 NOT NULL,
        "voice_minutes" integer DEFAULT 0 NOT NULL,
        "manual_points" integer DEFAULT 0 NOT NULL,
        "leaderboard_points" integer DEFAULT 0 NOT NULL,
        "last_updated" timestamp DEFAULT now() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS "bot_settings" (
        "id" serial PRIMARY KEY NOT NULL,
        "key" text NOT NULL UNIQUE,
        "value" text NOT NULL
      );

      CREATE TABLE IF NOT EXISTS "mod_ranks" (
        "id" serial PRIMARY KEY NOT NULL,
        "name" text NOT NULL,
        "required_points" integer NOT NULL
      );

      CREATE TABLE IF NOT EXISTS "shop_transactions" (
        "id" serial PRIMARY KEY NOT NULL,
        "guild_id" text NOT NULL,
        "buyer_discord_id" text NOT NULL,
        "buyer_username" text NOT NULL,
        "items" text[] NOT NULL,
        "total_msg_cost" integer DEFAULT 0 NOT NULL,
        "total_vc_hours_cost" integer DEFAULT 0 NOT NULL,
        "payment_type" text,
        "buyer_balance" integer,
        "purchased_at" timestamp DEFAULT now() NOT NULL,
        "expires_at" timestamp NOT NULL,
        "role_id" text
      );
      ALTER TABLE "shop_transactions" ADD COLUMN IF NOT EXISTS "payment_type" text;
      ALTER TABLE "shop_transactions" ADD COLUMN IF NOT EXISTS "buyer_balance" integer;

      CREATE TABLE IF NOT EXISTS "shop_roles" (
        "id" serial PRIMARY KEY NOT NULL,
        "transaction_id" integer NOT NULL,
        "guild_id" text NOT NULL,
        "role_id" text NOT NULL,
        "buyer_discord_id" text NOT NULL,
        "expires_at" timestamp NOT NULL,
        "expired" boolean DEFAULT false NOT NULL
      );
    `);
    console.log("Database schema ready.");
  } catch (err) {
    console.error("Schema initialization failed:", err);
    throw err;
  } finally {
    client.release();
  }
}
