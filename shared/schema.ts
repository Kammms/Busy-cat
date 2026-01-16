import { pgTable, text, serial, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const moderators = pgTable("moderators", {
  id: serial("id").primaryKey(),
  discordId: text("discord_id").notNull().unique(),
  username: text("username").notNull(),
  avatar: text("avatar"),
  isIgnored: boolean("is_ignored").default(false).notNull(),
  messageCount: integer("message_count").default(0).notNull(),
  inviteCount: integer("invite_count").default(0).notNull(),
  manualPoints: integer("manual_points").default(0).notNull(),
  leaderboardPoints: integer("leaderboard_points").default(0).notNull(),
  lastUpdated: timestamp("last_updated").defaultNow().notNull(),
});

export const botSettings = pgTable("bot_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
});

// Schemas
export const insertModeratorSchema = createInsertSchema(moderators).omit({ 
  id: true, 
  lastUpdated: true,
  messageCount: true,
  inviteCount: true,
  leaderboardPoints: true 
});

export const insertSettingSchema = createInsertSchema(botSettings).omit({ id: true });

// Types
export type Moderator = typeof moderators.$inferSelect;
export type InsertModerator = z.infer<typeof insertModeratorSchema>;
export type BotSetting = typeof botSettings.$inferSelect;
export type InsertBotSetting = z.infer<typeof insertSettingSchema>;

export type UpdateManualPointsRequest = {
  points: number;
  reason?: string;
};

// Settings Keys
export const SETTINGS_KEYS = {
  MODERATOR_ROLE_ID: 'moderator_role_id',
  TRACKED_CHANNEL_ID: 'tracked_channel_id',
  POINTS_PER_1000_MSG: 'points_per_1000_msg',
  POINTS_PER_INVITE: 'points_per_invite',
  LEADERBOARD_REWARDS: 'leaderboard_rewards',
} as const;
