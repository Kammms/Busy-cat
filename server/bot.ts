import { 
  Client, 
  GatewayIntentBits, 
  Partials, 
  Collection, 
  EmbedBuilder, 
  TextChannel, 
  SlashCommandBuilder, 
  REST, 
  Routes, 
  PermissionFlagsBits,
  ChatInputCommandInteraction,
  Invite
} from 'discord.js';
import { storage } from './storage';
import { SETTINGS_KEYS } from '@shared/schema';

// Minimal Invite interface for caching
interface CachedInvite {
  code: string;
  uses: number;
  inviterId: string | null;
}

export class DiscordBot {
  private client: Client;
  private inviteCache: Collection<string, Collection<string, CachedInvite>> = new Collection();
  private isReady: boolean = false;

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildMembers,
      ],
      partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
    });

    this.setupListeners();
  }

  private setupListeners() {
    this.client.once('ready', async () => {
      console.log(`Logged in as ${this.client.user?.tag}!`);
      this.isReady = true;
      await this.registerCommands();
      await this.refreshInviteCache();
      await this.recoverMissedMessages();
    });

    this.client.on('interactionCreate', async (interaction) => {
      if (interaction.isChatInputCommand()) {
        await this.handleInteraction(interaction);
      }
    });

    this.client.on('messageCreate', async (message) => {
      if (message.author.bot || !message.guild) return;

      const trackedChannelId = await storage.getSetting(SETTINGS_KEYS.TRACKED_CHANNEL_ID);
      const modRoleId = await storage.getSetting(SETTINGS_KEYS.MODERATOR_ROLE_ID);

      if (!trackedChannelId || !modRoleId) return;
      if (message.channelId !== trackedChannelId) return;

      const member = message.member;
      if (!member?.roles.cache.has(modRoleId)) return;

      let moderator = await storage.getModeratorByDiscordId(message.author.id);
      
      if (!moderator) {
        moderator = await storage.createModerator({
          discordId: message.author.id,
          username: message.author.username,
          avatar: message.author.avatar,
          isIgnored: false,
          manualPoints: 0,
        });
      }

      if (moderator.isIgnored) return;

      const updates: any = { messageCount: (moderator.messageCount || 0) + 1 };
      if (moderator.username !== message.author.username) updates.username = message.author.username;
      if (moderator.avatar !== message.author.avatar) updates.avatar = message.author.avatar;

      await storage.updateModerator(moderator.id, updates);
    });

    this.client.on('guildMemberAdd', async (member) => {
      const guild = member.guild;
      const cachedInvites = this.inviteCache.get(guild.id);
      
      const newInvites = await guild.invites.fetch().catch(() => new Collection<string, Invite>());
      
      const usedInvite = newInvites.find((inv: Invite) => {
        const cached = cachedInvites?.get(inv.code);
        return cached ? (inv.uses || 0) > (cached.uses || 0) : false;
      });

      if (usedInvite && usedInvite.inviter) {
        const modRoleId = await storage.getSetting(SETTINGS_KEYS.MODERATOR_ROLE_ID);
        try {
          const inviterMember = await guild.members.fetch(usedInvite.inviter.id);
          
          if (modRoleId && inviterMember.roles.cache.has(modRoleId)) {
             let moderator = await storage.getModeratorByDiscordId(usedInvite.inviter.id);
             
             if (moderator && !moderator.isIgnored) {
               await storage.updateModerator(moderator.id, {
                 inviteCount: (moderator.inviteCount || 0) + 1
               });
             }
          }
        } catch (e) {
          console.error("Error fetching inviter member:", e);
        }
      }

      this.inviteCache.set(guild.id, this.cacheInvites(newInvites));
    });
    
    this.client.on('inviteCreate', async (invite) => {
      if (invite.guild) {
        await this.refreshInviteCacheForGuild(invite.guild.id);
      }
    });
    
    this.client.on('inviteDelete', async (invite) => {
      if (invite.guild) {
        await this.refreshInviteCacheForGuild(invite.guild.id);
      }
    });
  }

  private async registerCommands() {
    if (!this.client.user) return;

    const commands = [
      new SlashCommandBuilder()
        .setName('set')
        .setDescription('Configure bot settings')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub =>
          sub.setName('manager')
            .setDescription('Set the moderator team role')
            .addRoleOption(opt => opt.setName('role').setDescription('The role that counts as moderator team').setRequired(true))
        )
        .addSubcommand(sub =>
          sub.setName('track')
            .setDescription('Set the tracking channel')
            .addChannelOption(opt => opt.setName('channel').setDescription('The channel to track messages in').setRequired(true))
        )
        .addSubcommand(sub =>
          sub.setName('points')
            .setDescription('Set point values')
            .addIntegerOption(opt => opt.setName('msgs').setDescription('Points per 1000 messages (default: 15)'))
            .addIntegerOption(opt => opt.setName('invites').setDescription('Points per invite (default: 1)'))
        ),
      new SlashCommandBuilder()
        .setName('exclude')
        .setDescription('Exclude a moderator from tracking')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(opt => opt.setName('user').setDescription('The user to exclude').setRequired(true)),
      new SlashCommandBuilder()
        .setName('stats')
        .setDescription('View moderator stats')
        .addUserOption(opt => opt.setName('user').setDescription('The user to view stats for (defaults to yourself)')),
      new SlashCommandBuilder()
        .setName('balance')
        .setDescription('Check your current points balance'),
      new SlashCommandBuilder()
        .setName('addpoints')
        .setDescription('Manually add points to a moderator')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(opt => opt.setName('user').setDescription('The user to add points to').setRequired(true))
        .addIntegerOption(opt => opt.setName('amount').setDescription('Amount of points to add').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for adding points')),
      new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Manually trigger weekly leaderboard')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: '10' }).setToken(this.client.token!);

    try {
      console.log('Started refreshing application (/) commands.');
      await rest.put(
        Routes.applicationCommands(this.client.user.id),
        { body: commands },
      );
      console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
      console.error(error);
    }
  }

  private async recoverMissedMessages() {
    console.log("Starting message recovery for missed activity...");
    const trackedChannelId = await storage.getSetting(SETTINGS_KEYS.TRACKED_CHANNEL_ID);
    const modRoleId = await storage.getSetting(SETTINGS_KEYS.MODERATOR_ROLE_ID);

    if (!trackedChannelId || !modRoleId) {
      console.log("Recovery skipped: Tracked channel or mod role not configured.");
      return;
    }

    try {
      const channel = await this.client.channels.fetch(trackedChannelId).catch(() => null);
      if (!channel || !(channel instanceof TextChannel)) {
        console.warn(`Recovery skipped: Channel ${trackedChannelId} not found or not a text channel.`);
        return;
      }

      const moderators = await storage.getModerators();
      if (moderators.length === 0) return;

      const earliestModUpdate = moderators
        .filter(m => !m.isIgnored)
        .reduce((min, m) => m.lastUpdated < min ? m.lastUpdated : min, new Date());

      let lastId: string | undefined;
      let totalChecked = 0;
      const MAX_RECOVERY = 500;

      while (totalChecked < MAX_RECOVERY) {
        const messages = await channel.messages.fetch({ limit: 100, before: lastId });
        if (messages.size === 0) break;

        const messageArray = Array.from(messages.values());
        for (const message of messageArray) {
          totalChecked++;
          if (message.author.bot || !message.guild) continue;
          if (message.createdAt < earliestModUpdate) {
            totalChecked = MAX_RECOVERY;
            break;
          }

          const member = await message.guild.members.fetch(message.author.id).catch(() => null);
          if (!member?.roles.cache.has(modRoleId)) continue;

          let moderator = await storage.getModeratorByDiscordId(message.author.id);
          if (moderator && !moderator.isIgnored && message.createdAt > moderator.lastUpdated) {
            await storage.updateModerator(moderator.id, {
              messageCount: (moderator.messageCount || 0) + 1
            });
          }
        }
        lastId = messages.last()?.id;
        if (totalChecked >= MAX_RECOVERY) break;
      }
      console.log("Message recovery complete.");
    } catch (e) {
      console.error("Failed to recover missed messages:", e);
    }
  }

  private async handleInteraction(interaction: ChatInputCommandInteraction) {
    const { commandName, options } = interaction;

    if (commandName === 'set') {
      const sub = options.getSubcommand();
      if (sub === 'manager') {
        const role = options.getRole('role', true);
        await storage.updateSetting(SETTINGS_KEYS.MODERATOR_ROLE_ID, role.id);
        await interaction.reply({ content: `✅ Moderator team role set to <@&${role.id}>`, ephemeral: true });
      } else if (sub === 'track') {
        const channel = options.getChannel('channel', true);
        await storage.updateSetting(SETTINGS_KEYS.TRACKED_CHANNEL_ID, channel.id);
        await interaction.reply({ content: `✅ Tracking channel set to <#${channel.id}>`, ephemeral: true });
      } else if (sub === 'points') {
        const msgs = options.getInteger('msgs');
        const invites = options.getInteger('invites');
        
        if (msgs !== null) await storage.updateSetting(SETTINGS_KEYS.POINTS_PER_1000_MSG, msgs.toString());
        if (invites !== null) await storage.updateSetting(SETTINGS_KEYS.POINTS_PER_INVITE, invites.toString());
        
        await interaction.reply({ content: `✅ Point values updated: ${msgs ?? 'unchanged'} per 1000 msgs, ${invites ?? 'unchanged'} per invite.`, ephemeral: true });
      }
    } else if (commandName === 'exclude') {
      const user = options.getUser('user', true);
      let moderator = await storage.getModeratorByDiscordId(user.id);
      
      if (!moderator) {
        moderator = await storage.createModerator({
          discordId: user.id,
          username: user.username,
          avatar: user.avatar,
          isIgnored: true,
          manualPoints: 0,
        });
      } else {
        await storage.updateModerator(moderator.id, { isIgnored: true });
      }
      
      await interaction.reply({ content: `✅ <@${user.id}> has been excluded from tracking.`, ephemeral: true });
    } else if (commandName === 'addpoints') {
      const user = options.getUser('user', true);
      const amount = options.getInteger('amount', true);
      const reason = options.getString('reason') || 'No reason provided';
      
      let mod = await storage.getModeratorByDiscordId(user.id);
      if (!mod) {
        mod = await storage.createModerator({
          discordId: user.id,
          username: user.username,
          avatar: user.avatar,
          isIgnored: false,
          manualPoints: amount,
        });
      } else {
        await storage.updateModerator(mod.id, { manualPoints: mod.manualPoints + amount });
      }
      
      await interaction.reply({ content: `✅ Added **${amount}** points to <@${user.id}>. Reason: ${reason}` });
    } else if (commandName === 'balance') {
      const mod = await storage.getModeratorByDiscordId(interaction.user.id);
      if (!mod) {
        return interaction.reply({ content: "❌ You are not a tracked moderator.", ephemeral: true });
      }

      const ptsPer1000 = parseInt(await storage.getSetting(SETTINGS_KEYS.POINTS_PER_1000_MSG) || '15');
      const ptsPerInvite = parseInt(await storage.getSetting(SETTINGS_KEYS.POINTS_PER_INVITE) || '1');
      const msgPoints = Math.floor(mod.messageCount / 1000) * ptsPer1000;
      const invitePoints = mod.inviteCount * ptsPerInvite;
      const totalPoints = msgPoints + invitePoints + mod.leaderboardPoints + mod.manualPoints;

      await interaction.reply({ content: `💰 Your current total balance is **${totalPoints}** points.` });
    } else if (commandName === 'leaderboard') {
      await interaction.deferReply({ ephemeral: true });
      try {
        await this.generateLeaderboard();
        await interaction.editReply({ content: '✅ Leaderboard generated and sent to the tracked channel.' });
      } catch (e: any) {
        await interaction.editReply({ content: `❌ Error: ${e.message}` });
      }
    } else if (commandName === 'stats') {
      const user = options.getUser('user') || interaction.user;
      const mod = await storage.getModeratorByDiscordId(user.id);

      if (!mod) {
        return interaction.reply({ content: `❌ No stats found for <@${user.id}>. Are they a tracked moderator?`, ephemeral: true });
      }

      const ptsPer1000 = parseInt(await storage.getSetting(SETTINGS_KEYS.POINTS_PER_1000_MSG) || '15');
      const ptsPerInvite = parseInt(await storage.getSetting(SETTINGS_KEYS.POINTS_PER_INVITE) || '1');

      const msgPoints = Math.floor(mod.messageCount / 1000) * ptsPer1000;
      const invitePoints = mod.inviteCount * ptsPerInvite;
      const totalPoints = msgPoints + invitePoints + mod.leaderboardPoints + mod.manualPoints;

      const embed = new EmbedBuilder()
        .setTitle(`Stats for ${user.username}`)
        .setThumbnail(user.displayAvatarURL())
        .addFields(
          { name: 'Messages', value: mod.messageCount.toString(), inline: true },
          { name: 'Invites', value: mod.inviteCount.toString(), inline: true },
          { name: 'Points (Messages)', value: msgPoints.toString(), inline: true },
          { name: 'Points (Invites)', value: invitePoints.toString(), inline: true },
          { name: 'Points (Leaderboard)', value: mod.leaderboardPoints.toString(), inline: true },
          { name: 'Points (Manual)', value: mod.manualPoints.toString(), inline: true },
          { name: 'Total Points', value: totalPoints.toString(), inline: false },
        )
        .setColor(0x00FF00);

      await interaction.reply({ embeds: [embed] });
    }
  }

  private cacheInvites(invites: Collection<string, any>): Collection<string, CachedInvite> {
    const cache = new Collection<string, CachedInvite>();
    invites.forEach(inv => {
      cache.set(inv.code, {
        code: inv.code,
        uses: inv.uses || 0,
        inviterId: inv.inviter?.id || null
      });
    });
    return cache;
  }
  
  private async refreshInviteCacheForGuild(guildId: string) {
    try {
      const guild = await this.client.guilds.fetch(guildId);
      const invites = await guild.invites.fetch();
      this.inviteCache.set(guildId, this.cacheInvites(invites));
    } catch (e) {
      console.error(`Failed to refresh invites for guild ${guildId}:`, e);
    }
  }

  public async refreshInviteCache() {
    console.log("Refreshing invite cache...");
    const guilds = Array.from(this.client.guilds.cache.values());
    for (const guild of guilds) {
      await this.refreshInviteCacheForGuild(guild.id);
    }
    return true;
  }

  public async generateLeaderboard() {
    const trackedChannelId = await storage.getSetting(SETTINGS_KEYS.TRACKED_CHANNEL_ID);
    if (!trackedChannelId) throw new Error("Tracked channel not set");

    const channel = await this.client.channels.fetch(trackedChannelId);
    if (!channel || !(channel instanceof TextChannel)) {
      throw new Error("Invalid tracked channel");
    }

    const moderators = await storage.getModerators();
    const ranked = moderators
      .filter(m => !m.isIgnored)
      .sort((a, b) => b.messageCount - a.messageCount);

    const embed = new EmbedBuilder()
      .setTitle("🏆 Weekly Moderator Leaderboard")
      .setColor(0xFFD700)
      .setTimestamp();

    const top3 = ranked.slice(0, 3);
    const rewards = [40, 30, 20];

    let description = "";

    for (let i = 0; i < top3.length; i++) {
      const mod = top3[i];
      const reward = rewards[i];
      
      await storage.updateModerator(mod.id, {
        leaderboardPoints: mod.leaderboardPoints + reward
      });

      description += `**#${i + 1}** <@${mod.discordId}> - ${mod.messageCount} msgs (+${reward} pts)\n`;
    }

    for (let i = 3; i < ranked.length; i++) {
      const mod = ranked[i];
      description += `**#${i + 1}** <@${mod.discordId}> - ${mod.messageCount} msgs\n`;
    }

    if (!description) description = "No active moderators tracked yet.";

    embed.setDescription(description);
    await channel.send({ embeds: [embed] });
    return true;
  }

  public async start(token: string) {
    try {
      await this.client.login(token);
    } catch (e) {
      console.error("Failed to login to Discord:", e);
    }
  }
}

export const bot = new DiscordBot();
