import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { bot } from "./bot";
import { SETTINGS_KEYS } from "@shared/schema";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Start the bot if token is present
  if (process.env.DISCORD_TOKEN) {
    bot.start(process.env.DISCORD_TOKEN).catch(console.error);
  } else {
    console.warn("DISCORD_TOKEN not found. Bot will not start until token is provided.");
  }

  // --- Moderators ---
  app.get(api.moderators.list.path, async (req, res) => {
    const mods = await storage.getModerators();
    res.json(mods);
  });

  app.post(api.moderators.updateManualPoints.path, async (req, res) => {
    const id = parseInt(req.params.id);
    const mod = await storage.getModerator(id);
    if (!mod) return res.status(404).json({ message: "Moderator not found" });

    const { points } = api.moderators.updateManualPoints.input.parse(req.body);
    const updated = await storage.updateModerator(id, {
      manualPoints: mod.manualPoints + points
    });
    res.json(updated);
  });

  app.post(api.moderators.toggleIgnore.path, async (req, res) => {
    const id = parseInt(req.params.id);
    const mod = await storage.getModerator(id);
    if (!mod) return res.status(404).json({ message: "Moderator not found" });

    const updated = await storage.updateModerator(id, {
      isIgnored: !mod.isIgnored
    });
    res.json(updated);
  });

  // --- Settings ---
  app.get(api.settings.list.path, async (req, res) => {
    const settings = await storage.getSettings();
    res.json(settings);
  });

  app.post(api.settings.update.path, async (req, res) => {
    const { key, value } = api.settings.update.input.parse(req.body);
    const updated = await storage.updateSetting(key, value);
    res.json(updated);
  });

  // --- Bot Actions ---
  app.post(api.bot.refreshCache.path, async (req, res) => {
    try {
      await bot.refreshInviteCache();
      res.json({ success: true, message: "Invite cache refreshed" });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.post(api.bot.generateLeaderboard.path, async (req, res) => {
    try {
      await bot.generateLeaderboard();
      res.json({ success: true, message: "Leaderboard generated and sent" });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  return httpServer;
}
