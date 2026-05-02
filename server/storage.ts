import { 
  moderators, botSettings, modRanks,
  type Moderator, type InsertModerator, 
  type BotSetting, type InsertBotSetting,
  type ModRank, type InsertModRank,
  SETTINGS_KEYS
} from "@shared/schema";
import { db } from "./db";
import { eq, asc } from "drizzle-orm";

export interface IStorage {
  // Moderators
  getModerators(): Promise<Moderator[]>;
  getModerator(id: number): Promise<Moderator | undefined>;
  getModeratorByDiscordId(discordId: string): Promise<Moderator | undefined>;
  createModerator(moderator: InsertModerator): Promise<Moderator>;
  updateModerator(id: number, updates: Partial<Moderator>): Promise<Moderator>;
  
  // Settings
  getSettings(): Promise<BotSetting[]>;
  getSetting(key: string): Promise<string | undefined>;
  updateSetting(key: string, value: string): Promise<BotSetting>;

  // Mod Ranks
  getModRanks(): Promise<ModRank[]>;
  createModRank(rank: InsertModRank): Promise<ModRank>;
  updateModRank(id: number, updates: Partial<ModRank>): Promise<ModRank>;
  deleteModRank(id: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getModerators(): Promise<Moderator[]> {
    return await db.select().from(moderators);
  }

  async getModerator(id: number): Promise<Moderator | undefined> {
    const [moderator] = await db.select().from(moderators).where(eq(moderators.id, id));
    return moderator;
  }

  async getModeratorByDiscordId(discordId: string): Promise<Moderator | undefined> {
    const [moderator] = await db.select().from(moderators).where(eq(moderators.discordId, discordId));
    return moderator;
  }

  async createModerator(insertModerator: InsertModerator): Promise<Moderator> {
    const [moderator] = await db.insert(moderators).values(insertModerator).returning();
    return moderator;
  }

  async updateModerator(id: number, updates: Partial<Moderator>): Promise<Moderator> {
    const [moderator] = await db
      .update(moderators)
      .set({ ...updates, lastUpdated: new Date() })
      .where(eq(moderators.id, id))
      .returning();
    return moderator;
  }

  async getSettings(): Promise<BotSetting[]> {
    return await db.select().from(botSettings);
  }

  async getSetting(key: string): Promise<string | undefined> {
    const [setting] = await db.select().from(botSettings).where(eq(botSettings.key, key));
    return setting?.value;
  }

  async updateSetting(key: string, value: string): Promise<BotSetting> {
    const [setting] = await db
      .insert(botSettings)
      .values({ key, value })
      .onConflictDoUpdate({
        target: botSettings.key,
        set: { value },
      })
      .returning();
    return setting;
  }

  async getModRanks(): Promise<ModRank[]> {
    return await db.select().from(modRanks).orderBy(asc(modRanks.requiredPoints));
  }

  async createModRank(rank: InsertModRank): Promise<ModRank> {
    const [newRank] = await db.insert(modRanks).values(rank).returning();
    return newRank;
  }

  async updateModRank(id: number, updates: Partial<ModRank>): Promise<ModRank> {
    const [updatedRank] = await db
      .update(modRanks)
      .set(updates)
      .where(eq(modRanks.id, id))
      .returning();
    return updatedRank;
  }

  async deleteModRank(id: number): Promise<void> {
    await db.delete(modRanks).where(eq(modRanks.id, id));
  }
}

export const storage = new DatabaseStorage();
