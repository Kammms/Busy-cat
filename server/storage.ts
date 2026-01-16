import { 
  moderators, botSettings, 
  type Moderator, type InsertModerator, 
  type BotSetting, type InsertBotSetting,
  SETTINGS_KEYS
} from "@shared/schema";
import { db } from "./db";
import { eq } from "drizzle-orm";

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
}

export const storage = new DatabaseStorage();
