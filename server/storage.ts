import { 
  moderators, botSettings, modRanks, shopTransactions, shopRoles,
  type Moderator, type InsertModerator, 
  type BotSetting, type InsertBotSetting,
  type ModRank, type InsertModRank,
  type ShopTransaction, type InsertShopTransaction,
  type ShopRole, type InsertShopRole,
  SETTINGS_KEYS
} from "@shared/schema";
import { db } from "./db";
import { eq, asc, desc, lt, and } from "drizzle-orm";

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

  // Shop
  createShopTransaction(tx: InsertShopTransaction): Promise<ShopTransaction>;
  getShopTransactions(guildId: string, limit?: number): Promise<ShopTransaction[]>;
  createShopRole(role: InsertShopRole): Promise<ShopRole>;
  getExpiredShopRoles(): Promise<ShopRole[]>;
  markShopRoleExpired(id: number): Promise<void>;
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

  async createShopTransaction(tx: InsertShopTransaction): Promise<ShopTransaction> {
    const [transaction] = await db.insert(shopTransactions).values(tx).returning();
    return transaction;
  }

  async getShopTransactions(guildId: string, limit = 50): Promise<ShopTransaction[]> {
    return await db
      .select()
      .from(shopTransactions)
      .where(eq(shopTransactions.guildId, guildId))
      .orderBy(desc(shopTransactions.purchasedAt))
      .limit(limit);
  }

  async createShopRole(role: InsertShopRole): Promise<ShopRole> {
    const [shopRole] = await db.insert(shopRoles).values(role).returning();
    return shopRole;
  }

  async getExpiredShopRoles(): Promise<ShopRole[]> {
    return await db
      .select()
      .from(shopRoles)
      .where(and(eq(shopRoles.expired, false), lt(shopRoles.expiresAt, new Date())));
  }

  async markShopRoleExpired(id: number): Promise<void> {
    await db.update(shopRoles).set({ expired: true }).where(eq(shopRoles.id, id));
  }
}

export const storage = new DatabaseStorage();
