import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
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
  voiceMinutes: integer("voice_minutes").default(0).notNull(),
  manualPoints: integer("manual_points").default(0).notNull(),
  leaderboardPoints: integer("leaderboard_points").default(0).notNull(),
  lastUpdated: timestamp("last_updated").defaultNow().notNull(),
});

export const botSettings = pgTable("bot_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
});

export const modRanks = pgTable("mod_ranks", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  requiredPoints: integer("required_points").notNull(),
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
export const insertModRankSchema = createInsertSchema(modRanks).omit({ id: true });

// Types
export type Moderator = typeof moderators.$inferSelect;
export type InsertModerator = z.infer<typeof insertModeratorSchema>;
export type BotSetting = typeof botSettings.$inferSelect;
export type InsertBotSetting = z.infer<typeof insertSettingSchema>;
export type ModRank = typeof modRanks.$inferSelect;
export type InsertModRank = z.infer<typeof insertModRankSchema>;

export type UpdateManualPointsRequest = {
  points: number;
  reason?: string;
};

// Settings Keys
export const SETTINGS_KEYS = {
  MODERATOR_ROLE_ID: 'moderator_role_id',
  TRACKED_CHANNEL_ID: 'tracked_channel_id',
  POINTS_PER_MSG: 'points_per_msg',
  MESSAGE_THRESHOLD: 'message_threshold',
  POINTS_PER_INVITE: 'points_per_invite',
  POINTS_PER_VOICE_HOUR: 'points_per_voice_hour',
  LEADERBOARD_REWARDS: 'leaderboard_rewards',
  GENDER_ROLE_IDS: 'gender_role_ids',
  GENDER_LOG_CHANNEL_ID: 'gender_log_channel_id',
  GENDER_EXPOSE_CHANNEL_ID: 'gender_expose_channel_id',
} as const;
