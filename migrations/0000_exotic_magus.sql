CREATE TABLE "bot_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "bot_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "mod_ranks" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"required_points" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moderators" (
	"id" serial PRIMARY KEY NOT NULL,
	"discord_id" text NOT NULL,
	"username" text NOT NULL,
	"avatar" text,
	"is_ignored" boolean DEFAULT false NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"invite_count" integer DEFAULT 0 NOT NULL,
	"voice_minutes" integer DEFAULT 0 NOT NULL,
	"manual_points" integer DEFAULT 0 NOT NULL,
	"leaderboard_points" integer DEFAULT 0 NOT NULL,
	"last_updated" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "moderators_discord_id_unique" UNIQUE("discord_id")
);
