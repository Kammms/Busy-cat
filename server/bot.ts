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
  AuditLogEvent,
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
  private voiceJoinTimes: Map<string, number> = new Map();

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
      ],
      partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
    });

    this.setupListeners();
  }

  private setupListeners() {
    this.client.on('guildMemberUpdate', async (oldMember, newMember) => {
      // Ensure we have full role data before any checks
      if (oldMember.partial) {
        try { await oldMember.fetch(); } catch { return; }
      }
      if (newMember.partial) {
        try { await newMember.fetch(); } catch { return; }
      }

      // --- Moderator role auto-tracking ---
      const modRoleId = await storage.getSetting(SETTINGS_KEYS.MODERATOR_ROLE_ID);
      if (modRoleId) {
        const hadRole = oldMember.roles.cache.has(modRoleId);
        const hasRole = newMember.roles.cache.has(modRoleId);
        if (!hadRole && hasRole) {
          let moderator = await storage.getModeratorByDiscordId(newMember.id);
          if (!moderator) {
            await storage.createModerator({
              discordId: newMember.id,
              username: newMember.user.username,
              avatar: newMember.user.avatar,
              isIgnored: false,
              manualPoints: 0,
            });
            console.log(`Auto-tracked new moderator: ${newMember.user.username}`);
          } else if (moderator.isIgnored) {
            await storage.updateModerator(moderator.id, { isIgnored: false });
            console.log(`Auto-included previously ignored moderator: ${newMember.user.username}`);
          }
        }
      }

      // --- Gender role switch detection ---
      await (async () => {
        const genderRoleIdsSetting = await storage.getSetting(SETTINGS_KEYS.GENDER_ROLE_IDS);
        if (!genderRoleIdsSetting) return;
        const genderRoleIds = genderRoleIdsSetting.split(',').map(s => s.trim()).filter(Boolean);
        if (genderRoleIds.length < 2) return;

        const oldGenderRole = genderRoleIds.find(id => oldMember.roles.cache.has(id));
        const newGenderRole = genderRoleIds.find(id => newMember.roles.cache.has(id));

        if (!oldGenderRole || !newGenderRole || oldGenderRole === newGenderRole) return;

        const genderBypassRoleId = await storage.getSetting(SETTINGS_KEYS.GENDER_BYPASS_ROLE_ID);
        if (genderBypassRoleId) {
          try {
            const logs = await newMember.guild.fetchAuditLogs({ type: AuditLogEvent.MemberRoleUpdate, limit: 5 });
            const entry = logs.entries.find(e => (e.target as any)?.id === newMember.id);
            if (entry?.executor) {
              const executor = await newMember.guild.members.fetch(entry.executor.id).catch(() => null);
              if (executor?.roles.cache.has(genderBypassRoleId)) return;
            }
          } catch {}
        }

        try {
          await newMember.roles.remove(newGenderRole);
          await newMember.roles.add(oldGenderRole);
          console.log(`Reverted gender role switch for ${newMember.user.username}`);

          const logChannelId = await storage.getSetting(SETTINGS_KEYS.GENDER_LOG_CHANNEL_ID);
          if (logChannelId) {
            const logChannel = newMember.guild.channels.cache.get(logChannelId);
            if (logChannel instanceof TextChannel) {
              await logChannel.send({
                embeds: [new EmbedBuilder()
                  .setTitle('⚠️ Gender Role Switch Detected')
                  .setDescription(`<@${newMember.id}> attempted to switch their gender role.`)
                  .addFields(
                    { name: 'Original Role', value: `<@&${oldGenderRole}>`, inline: true },
                    { name: 'Attempted Role', value: `<@&${newGenderRole}>`, inline: true },
                    { name: 'Action Taken', value: 'Role reverted automatically.', inline: false },
                  )
                  .setThumbnail(newMember.user.displayAvatarURL())
                  .setColor(0xd2a4bf)
                  .setTimestamp()],
              });
            }
          }

          const exposeChannelId = await storage.getSetting(SETTINGS_KEYS.GENDER_EXPOSE_CHANNEL_ID);
          if (exposeChannelId) {
            const exposeChannel = newMember.guild.channels.cache.get(exposeChannelId);
            if (exposeChannel instanceof TextChannel) {
              await exposeChannel.send({
                embeds: [new EmbedBuilder()
                  .setTitle('👀 Caught in 4K')
                  .setDescription(
                    `<@${newMember.id}> just tried to switch from <@&${oldGenderRole}> to <@&${newGenderRole}> just to lurk in the <@&${newGenderRole}> channel. 💀\n\nMake a ticket to change your age role.`
                  )
                  .setThumbnail(newMember.user.displayAvatarURL())
                  .setColor(0xd2a4bf)
                  .setTimestamp()],
              });
            }
          }
        } catch (err) {
          console.error(`Failed to revert gender role for ${newMember.user.username}:`, err);
        }
      })();

      // --- Age role protection ---
      await (async () => {
        const ageAdultRoleId = await storage.getSetting(SETTINGS_KEYS.AGE_ADULT_ROLE_ID);
        const ageMinorRoleIdsSetting = await storage.getSetting(SETTINGS_KEYS.AGE_MINOR_ROLE_IDS);
        if (!ageAdultRoleId || !ageMinorRoleIdsSetting) return;
        const ageMinorRoleIds = ageMinorRoleIdsSetting.split(',').map(s => s.trim()).filter(Boolean);
        if (ageMinorRoleIds.length === 0) return;

        const oldMinorRole = ageMinorRoleIds.find(id => oldMember.roles.cache.has(id));
        const newMinorRole = ageMinorRoleIds.find(id => newMember.roles.cache.has(id));
        const hadAdultRole = oldMember.roles.cache.has(ageAdultRoleId);
        const nowHasAdultRole = newMember.roles.cache.has(ageAdultRoleId);

        // Case 1: switched from a minor role to the adult role
        const minorToAdult = !!oldMinorRole && nowHasAdultRole && !hadAdultRole;
        // Case 2: switched from one minor role to a different minor role
        const minorToMinor = !!oldMinorRole && !!newMinorRole && oldMinorRole !== newMinorRole;

        if (!minorToAdult && !minorToMinor) return;

        // Bypass check
        const ageBypassRoleId = await storage.getSetting(SETTINGS_KEYS.AGE_BYPASS_ROLE_ID);
        if (ageBypassRoleId) {
          try {
            const logs = await newMember.guild.fetchAuditLogs({ type: AuditLogEvent.MemberRoleUpdate, limit: 5 });
            const entry = logs.entries.find(e => (e.target as any)?.id === newMember.id);
            if (entry?.executor) {
              const executor = await newMember.guild.members.fetch(entry.executor.id).catch(() => null);
              if (executor?.roles.cache.has(ageBypassRoleId)) return;
            }
          } catch {}
        }

        const attemptedRole = minorToAdult ? ageAdultRoleId : newMinorRole!;

        try {
          await newMember.roles.remove(attemptedRole);
          await newMember.roles.add(oldMinorRole!);
          console.log(`Reverted age role switch for ${newMember.user.username}`);

          const ageLogChannelId = await storage.getSetting(SETTINGS_KEYS.AGE_LOG_CHANNEL_ID);
          if (ageLogChannelId) {
            const logChannel = newMember.guild.channels.cache.get(ageLogChannelId);
            if (logChannel instanceof TextChannel) {
              await logChannel.send({
                embeds: [new EmbedBuilder()
                  .setTitle('⚠️ Age Role Switch Detected')
                  .setDescription(
                    minorToAdult
                      ? `<@${newMember.id}> attempted to switch from a minor role to the adult role.`
                      : `<@${newMember.id}> attempted to switch between minor roles.`
                  )
                  .addFields(
                    { name: 'Original Role', value: `<@&${oldMinorRole}>`, inline: true },
                    { name: 'Attempted Role', value: `<@&${attemptedRole}>`, inline: true },
                    { name: 'Action Taken', value: 'Role reverted automatically.', inline: false },
                  )
                  .setThumbnail(newMember.user.displayAvatarURL())
                  .setColor(0xd2a4bf)
                  .setTimestamp()],
              });
            }
          }

          const ageExposeChannelId = await storage.getSetting(SETTINGS_KEYS.AGE_EXPOSE_CHANNEL_ID);
          if (ageExposeChannelId) {
            const exposeChannel = newMember.guild.channels.cache.get(ageExposeChannelId);
            if (exposeChannel instanceof TextChannel) {
              await exposeChannel.send({
                embeds: [new EmbedBuilder()
                  .setTitle(minorToAdult ? '👀 Caught in 4K' : '👀 Caught in 4K')
                  .setDescription(
                    minorToAdult
                      ? `<@${newMember.id}> just tried to swap their <@&${oldMinorRole}> role for <@&${ageAdultRoleId}> to sneak into the adult channel. 💀\n\nMake a ticket to change your age role.`
                      : `<@${newMember.id}> just tried to switch from <@&${oldMinorRole}> to <@&${newMinorRole}> 👀\n\nMake a ticket to change your age role.`
                  )
                  .setThumbnail(newMember.user.displayAvatarURL())
                  .setColor(0xd2a4bf)
                  .setTimestamp()],
              });
            }
          }
        } catch (err) {
          console.error(`Failed to revert age role for ${newMember.user.username}:`, err);
        }
      })();
    });

    this.client.once('clientReady', async () => {
      console.log(`Logged in as ${this.client.user?.tag}!`);
      this.isReady = true;
      await this.registerCommands();
      await this.refreshInviteCache();
      await this.recoverMissedMessages();
    });

    this.client.on('interactionCreate', async (interaction) => {
      if (interaction.isChatInputCommand()) {
        try {
          await this.handleInteraction(interaction);
        } catch (err) {
          console.error('Unhandled interaction error:', err);
          try {
            const msg = { content: '❌ Something went wrong.', ephemeral: true };
            if (interaction.replied || interaction.deferred) {
              await interaction.followUp(msg);
            } else {
              await interaction.reply(msg);
            }
          } catch {}
        }
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

    this.client.on('voiceStateUpdate', async (oldState, newState) => {
      const modRoleId = await storage.getSetting(SETTINGS_KEYS.MODERATOR_ROLE_ID);
      if (!modRoleId) return;

      const member = newState.member || oldState.member;
      if (!member || !member.roles.cache.has(modRoleId)) return;

      const userId = member.id;
      const joinedChannel = !oldState.channelId && newState.channelId;
      const leftChannel = oldState.channelId && !newState.channelId;

      if (joinedChannel) {
        this.voiceJoinTimes.set(userId, Date.now());
      } else if (leftChannel) {
        const joinTime = this.voiceJoinTimes.get(userId);
        if (!joinTime) return;
        this.voiceJoinTimes.delete(userId);

        const minutesSpent = Math.floor((Date.now() - joinTime) / 60000);
        if (minutesSpent <= 0) return;

        let mod = await storage.getModeratorByDiscordId(userId);
        if (!mod || mod.isIgnored) return;

        await storage.updateModerator(mod.id, { voiceMinutes: (mod.voiceMinutes || 0) + minutesSpent });
        console.log(`Voice: ${member.user.username} spent ${minutesSpent} minutes in VC.`);
      }
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
          sub.setName('team')
            .setDescription('Set the tracked team role')
            .addRoleOption(opt => opt.setName('role').setDescription('The role that will be tracked').setRequired(true))
        )
        .addSubcommand(sub =>
          sub.setName('track')
            .setDescription('Set the main channel')
            .addChannelOption(opt => opt.setName('channel').setDescription('The channel to track messages in').setRequired(true))
        )
        .addSubcommand(sub =>
          sub.setName('points')
            .setDescription('Set point values')
            .addIntegerOption(opt => opt.setName('points').setDescription('Points to award per message threshold (default: 15)'))
            .addIntegerOption(opt => opt.setName('threshold').setDescription('Message threshold (default: 1000)'))
            .addIntegerOption(opt => opt.setName('invites').setDescription('Points per invite (default: 1)'))
            .addIntegerOption(opt => opt.setName('voice').setDescription('Points per voice chat hour (default: 5)'))
            .addIntegerOption(opt => opt.setName('rank1').setDescription('Points for 1st place (default: 40)'))
            .addIntegerOption(opt => opt.setName('rank2').setDescription('Points for 2nd place (default: 30)'))
            .addIntegerOption(opt => opt.setName('rank3').setDescription('Points for 3rd place (default: 20)'))
        )
        .addSubcommand(sub =>
          sub.setName('gender')
            .setDescription('Configure gender role protection')
            .addRoleOption(opt => opt.setName('role1').setDescription('First gender role to protect').setRequired(false))
            .addRoleOption(opt => opt.setName('role2').setDescription('Second gender role to protect').setRequired(false))
            .addChannelOption(opt => opt.setName('log').setDescription('Private channel for admin alerts').setRequired(false))
            .addChannelOption(opt => opt.setName('expose').setDescription('Public channel to call them out').setRequired(false))
            .addRoleOption(opt => opt.setName('bypass').setDescription('Role whose members can change gender roles without being flagged (e.g. Moderator)').setRequired(false))
        )
        .addSubcommand(sub =>
          sub.setName('age')
            .setDescription('Configure age role protection (prevents minors accessing adult channels)')
            .addRoleOption(opt => opt.setName('minor1').setDescription('First minor role').setRequired(false))
            .addRoleOption(opt => opt.setName('minor2').setDescription('Second minor role').setRequired(false))
            .addRoleOption(opt => opt.setName('adult').setDescription('Adult role to protect').setRequired(false))
            .addChannelOption(opt => opt.setName('log').setDescription('Private channel for admin alerts').setRequired(false))
            .addChannelOption(opt => opt.setName('expose').setDescription('Public channel to call them out').setRequired(false))
            .addRoleOption(opt => opt.setName('bypass').setDescription('Role whose members can change age roles without being flagged').setRequired(false))
        ),
      new SlashCommandBuilder()
        .setName('exclude')
        .setDescription('Exclude a member from tracking')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(opt => opt.setName('user').setDescription('The user to exclude').setRequired(true)),
      new SlashCommandBuilder()
        .setName('include')
        .setDescription('Include a member in tracking')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(opt => opt.setName('user').setDescription('The user to include').setRequired(true)),
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
        .setName('addpoints-all')
        .setDescription('Manually add points to all tracked moderators')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addIntegerOption(opt => opt.setName('amount').setDescription('Amount of points to add').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for adding points')),
      new SlashCommandBuilder()
        .setName('removepoints')
        .setDescription('Manually remove points from a moderator')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(opt => opt.setName('user').setDescription('The user to remove points from').setRequired(true))
        .addIntegerOption(opt => opt.setName('amount').setDescription('Amount of points to remove').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for removing points')),
      new SlashCommandBuilder()
        .setName('adjust')
        .setDescription('Manually adjust a moderator\'s stats')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(opt => opt.setName('user').setDescription('The user to adjust stats for').setRequired(true))
        .addStringOption(opt => opt.setName('type').setDescription('The type of stat to adjust').setRequired(true)
          .addChoices({ name: 'Messages', value: 'messages' }, { name: 'Invites', value: 'invites' }, { name: 'Voice Hours', value: 'voicehours' }, { name: 'Leaderboard Points', value: 'leaderboardpoints' }))
        .addIntegerOption(opt => opt.setName('amount').setDescription('Amount to add (use negative to subtract) for messages/invites/voicehours').setRequired(false))
        .addStringOption(opt => opt.setName('rank').setDescription('Statbot position to award points').setRequired(false)
          .addChoices({ name: '1st Place', value: 'rank1' }, { name: '2nd Place', value: 'rank2' }, { name: '3rd Place', value: 'rank3' })),
      new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('View leaderboard'),
      new SlashCommandBuilder()
        .setName('ranks')
        .setDescription('Manage moderator ranks')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub =>
          sub.setName('add')
            .setDescription('Add a new moderator rank')
            .addStringOption(opt => opt.setName('name').setDescription('Name of the rank').setRequired(true))
            .addIntegerOption(opt => opt.setName('points').setDescription('Points required for this rank').setRequired(true))
        )
        .addSubcommand(sub =>
          sub.setName('modify')
            .setDescription('Modify an existing moderator rank')
            .addIntegerOption(opt => opt.setName('id').setDescription('ID of the rank to modify').setRequired(true))
            .addStringOption(opt => opt.setName('name').setDescription('New name for the rank'))
            .addIntegerOption(opt => opt.setName('points').setDescription('New points required'))
        )
        .addSubcommand(sub =>
          sub.setName('remove')
            .setDescription('Remove a moderator rank')
            .addIntegerOption(opt => opt.setName('id').setDescription('ID of the rank to remove').setRequired(true))
        )
        .addSubcommand(sub =>
          sub.setName('list')
            .setDescription('List all moderator ranks')
        ),
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
    const earliestModUpdate = moderators
      .filter(m => !m.isIgnored)
      .reduce((min, m) => m.lastUpdated < min ? m.lastUpdated : min, new Date());

    let lastId: string | undefined;
    let totalChecked = 0;
    const MAX_RECOVERY = 2000;

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
        if (!member || (modRoleId && !member.roles.cache.has(modRoleId))) continue;

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
      if (sub === 'team') {
        const role = options.getRole('role', true);
        await storage.updateSetting(SETTINGS_KEYS.MODERATOR_ROLE_ID, role.id);
        await interaction.reply({ content: `✅ Moderator team role set to <@&${role.id}>`, ephemeral: true });
      } else if (sub === 'track') {
        const channel = options.getChannel('channel', true);
        await storage.updateSetting(SETTINGS_KEYS.TRACKED_CHANNEL_ID, channel.id);
        await interaction.reply({ content: `✅ Tracking channel set to <#${channel.id}>`, ephemeral: true });
      } else if (sub === 'gender') {
        const role1 = options.getRole('role1');
        const role2 = options.getRole('role2');
        const log = options.getChannel('log');

        const expose = options.getChannel('expose');

        if (role1 || role2) {
          const current = (await storage.getSetting(SETTINGS_KEYS.GENDER_ROLE_IDS) || '').split(',').map(s => s.trim()).filter(Boolean);
          if (role1 && !current.includes(role1.id)) current.push(role1.id);
          if (role2 && !current.includes(role2.id)) current.push(role2.id);
          await storage.updateSetting(SETTINGS_KEYS.GENDER_ROLE_IDS, current.join(','));
        }
        const bypass = options.getRole('bypass');
        if (log) await storage.updateSetting(SETTINGS_KEYS.GENDER_LOG_CHANNEL_ID, log.id);
        if (expose) await storage.updateSetting(SETTINGS_KEYS.GENDER_EXPOSE_CHANNEL_ID, expose.id);
        if (bypass) await storage.updateSetting(SETTINGS_KEYS.GENDER_BYPASS_ROLE_ID, bypass.id);

        const updatedIds = (await storage.getSetting(SETTINGS_KEYS.GENDER_ROLE_IDS) || '').split(',').filter(Boolean);
        const roleList = updatedIds.map(id => `<@&${id}>`).join(', ') || 'None';
        const logId = await storage.getSetting(SETTINGS_KEYS.GENDER_LOG_CHANNEL_ID);
        const exposeId = await storage.getSetting(SETTINGS_KEYS.GENDER_EXPOSE_CHANNEL_ID);
        const bypassId = await storage.getSetting(SETTINGS_KEYS.GENDER_BYPASS_ROLE_ID);

        await interaction.reply({
          content: `✅ Gender protection updated.\n**Protected roles:** ${roleList}\n**Admin log:** ${logId ? `<#${logId}>` : 'Not set'}\n**Expose channel:** ${exposeId ? `<#${exposeId}>` : 'Not set'}\n**Bypass role:** ${bypassId ? `<@&${bypassId}>` : 'Not set'}`,
          ephemeral: true,
        });
      } else if (sub === 'age') {
        const minor1 = options.getRole('minor1');
        const minor2 = options.getRole('minor2');
        const adult = options.getRole('adult');
        const log = options.getChannel('log');
        const expose = options.getChannel('expose');
        const bypass = options.getRole('bypass');

        if (minor1 || minor2) {
          const current = (await storage.getSetting(SETTINGS_KEYS.AGE_MINOR_ROLE_IDS) || '').split(',').map(s => s.trim()).filter(Boolean);
          if (minor1 && !current.includes(minor1.id)) current.push(minor1.id);
          if (minor2 && !current.includes(minor2.id)) current.push(minor2.id);
          await storage.updateSetting(SETTINGS_KEYS.AGE_MINOR_ROLE_IDS, current.join(','));
        }
        if (adult) await storage.updateSetting(SETTINGS_KEYS.AGE_ADULT_ROLE_ID, adult.id);
        if (log) await storage.updateSetting(SETTINGS_KEYS.AGE_LOG_CHANNEL_ID, log.id);
        if (expose) await storage.updateSetting(SETTINGS_KEYS.AGE_EXPOSE_CHANNEL_ID, expose.id);
        if (bypass) await storage.updateSetting(SETTINGS_KEYS.AGE_BYPASS_ROLE_ID, bypass.id);

        const minorIds = (await storage.getSetting(SETTINGS_KEYS.AGE_MINOR_ROLE_IDS) || '').split(',').filter(Boolean);
        const adultId = await storage.getSetting(SETTINGS_KEYS.AGE_ADULT_ROLE_ID);
        const logId = await storage.getSetting(SETTINGS_KEYS.AGE_LOG_CHANNEL_ID);
        const exposeId = await storage.getSetting(SETTINGS_KEYS.AGE_EXPOSE_CHANNEL_ID);
        const bypassId = await storage.getSetting(SETTINGS_KEYS.AGE_BYPASS_ROLE_ID);

        await interaction.reply({
          content: `✅ Age protection updated.\n**Minor roles:** ${minorIds.map(id => `<@&${id}>`).join(', ') || 'None'}\n**Adult role:** ${adultId ? `<@&${adultId}>` : 'Not set'}\n**Admin log:** ${logId ? `<#${logId}>` : 'Not set'}\n**Expose channel:** ${exposeId ? `<#${exposeId}>` : 'Not set'}\n**Bypass role:** ${bypassId ? `<@&${bypassId}>` : 'Not set'}`,
          ephemeral: true,
        });
      } else if (sub === 'points') {
        const points = options.getInteger('points');
        const threshold = options.getInteger('threshold');
        const invites = options.getInteger('invites');
        const voice = options.getInteger('voice');
        const r1 = options.getInteger('rank1');
        const r2 = options.getInteger('rank2');
        const r3 = options.getInteger('rank3');
        
        if (points !== null) await storage.updateSetting(SETTINGS_KEYS.POINTS_PER_MSG, points.toString());
        if (threshold !== null) await storage.updateSetting(SETTINGS_KEYS.MESSAGE_THRESHOLD, threshold.toString());
        if (invites !== null) await storage.updateSetting(SETTINGS_KEYS.POINTS_PER_INVITE, invites.toString());
        if (voice !== null) await storage.updateSetting(SETTINGS_KEYS.POINTS_PER_VOICE_HOUR, voice.toString());
        if (r1 !== null || r2 !== null || r3 !== null) {
          const currentRewards = (await storage.getSetting(SETTINGS_KEYS.LEADERBOARD_REWARDS) || '40,30,20').split(',').map(Number);
          if (r1 !== null) currentRewards[0] = r1;
          if (r2 !== null) currentRewards[1] = r2;
          if (r3 !== null) currentRewards[2] = r3;
          await storage.updateSetting(SETTINGS_KEYS.LEADERBOARD_REWARDS, currentRewards.join(','));
        }
        
        await interaction.reply({ content: `✅ Point values updated.`, ephemeral: true });
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
    } else if (commandName === 'include') {
      const user = options.getUser('user', true);
      let moderator = await storage.getModeratorByDiscordId(user.id);
      
      if (moderator) {
        await storage.updateModerator(moderator.id, { isIgnored: false });
        await interaction.reply({ content: `✅ <@${user.id}> has been included back in tracking.`, ephemeral: true });
      } else {
        await interaction.reply({ content: `❌ <@${user.id}> is not in the system. They will be added automatically when they send a message in the tracked channel.`, ephemeral: true });
      }
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
    } else if (commandName === 'addpoints-all') {
      const amount = options.getInteger('amount', true);
      const reason = options.getString('reason') || 'No reason provided';
      
      const moderators = await storage.getModerators();
      const activeMods = moderators.filter(m => !m.isIgnored);
      
      for (const mod of activeMods) {
        await storage.updateModerator(mod.id, { manualPoints: mod.manualPoints + amount });
      }
      
      await interaction.reply({ content: `✅ Added **${amount}** points to **${activeMods.length}** tracked moderators. Reason: ${reason}` });
    } else if (commandName === 'removepoints') {
      const user = options.getUser('user', true);
      const amount = options.getInteger('amount', true);
      const reason = options.getString('reason') || 'No reason provided';
      
      let mod = await storage.getModeratorByDiscordId(user.id);
      if (!mod) {
        return interaction.reply({ content: "❌ This user is not a tracked moderator.", ephemeral: true });
      }
      
      await storage.updateModerator(mod.id, { manualPoints: mod.manualPoints - amount });
      await interaction.reply({ content: `✅ Removed **${amount}** points from <@${user.id}>. Reason: ${reason}` });
    } else if (commandName === 'adjust') {
      const user = options.getUser('user', true);
      const type = options.getString('type', true);
      const amount = options.getInteger('amount');
      const rank = options.getString('rank');

      let mod = await storage.getModeratorByDiscordId(user.id);
      if (!mod) {
        mod = await storage.createModerator({
          discordId: user.id,
          username: user.username,
          avatar: user.avatar,
          isIgnored: false,
          manualPoints: 0,
        });
      }

      if (type === 'messages') {
        if (amount === null) return interaction.reply({ content: '❌ Please provide an `amount` for this type.', ephemeral: true });
        await storage.updateModerator(mod.id, { messageCount: Math.max(0, mod.messageCount + amount) });
        await interaction.reply({ content: `✅ Adjusted message count for <@${user.id}> by **${amount}**.` });
      } else if (type === 'invites') {
        if (amount === null) return interaction.reply({ content: '❌ Please provide an `amount` for this type.', ephemeral: true });
        await storage.updateModerator(mod.id, { inviteCount: Math.max(0, mod.inviteCount + amount) });
        await interaction.reply({ content: `✅ Adjusted invite count for <@${user.id}> by **${amount}**.` });
      } else if (type === 'voicehours') {
        if (amount === null) return interaction.reply({ content: '❌ Please provide an `amount` for this type.', ephemeral: true });
        const minutesToAdd = amount * 60;
        await storage.updateModerator(mod.id, { voiceMinutes: Math.max(0, (mod.voiceMinutes || 0) + minutesToAdd) });
        await interaction.reply({ content: `✅ Adjusted voice hours for <@${user.id}> by **${amount}** hour(s).` });
      } else if (type === 'leaderboardpoints') {
        let pointsToAdd: number;
        let label: string;

        if (rank) {
          const rewards = (await storage.getSetting(SETTINGS_KEYS.LEADERBOARD_REWARDS) || '40,30,20').split(',').map(Number);
          const rankIndex = rank === 'rank1' ? 0 : rank === 'rank2' ? 1 : 2;
          const rankNames = ['1st Place', '2nd Place', '3rd Place'];
          pointsToAdd = rewards[rankIndex];
          label = `${rankNames[rankIndex]} (${pointsToAdd} pts)`;
        } else if (amount !== null) {
          pointsToAdd = amount;
          label = `${amount} pts`;
        } else {
          return interaction.reply({ content: '❌ Please provide either a `rank` or an `amount` for leaderboard points.', ephemeral: true });
        }

        await storage.updateModerator(mod.id, { leaderboardPoints: Math.max(0, mod.leaderboardPoints + pointsToAdd) });
        await interaction.reply({ content: `✅ Added **${label}** of leaderboard points to <@${user.id}>.` });
      }
    } else if (commandName === 'balance') {
      const mod = await storage.getModeratorByDiscordId(interaction.user.id);
      if (!mod) {
        return interaction.reply({ content: "❌ You are not a tracked moderator.", ephemeral: true });
      }

      const ptsPerMsg = parseInt(await storage.getSetting(SETTINGS_KEYS.POINTS_PER_MSG) || '15');
      const threshold = parseInt(await storage.getSetting(SETTINGS_KEYS.MESSAGE_THRESHOLD) || '1000');
      const ptsPerInvite = parseInt(await storage.getSetting(SETTINGS_KEYS.POINTS_PER_INVITE) || '1');
      const ptsPerVoiceHour = parseInt(await storage.getSetting(SETTINGS_KEYS.POINTS_PER_VOICE_HOUR) || '5');
      const msgPoints = Math.floor(mod.messageCount / threshold) * ptsPerMsg;
      const invitePoints = mod.inviteCount * ptsPerInvite;
      const voicePoints = Math.floor((mod.voiceMinutes || 0) / 60) * ptsPerVoiceHour;
      const totalPoints = msgPoints + invitePoints + voicePoints + mod.leaderboardPoints + mod.manualPoints;

      await interaction.reply({ content: `Your current total balance is **${totalPoints}** points.` });
    } else if (commandName === 'leaderboard') {
      await interaction.deferReply({ ephemeral: true });
      try {
        if (interaction.channel instanceof TextChannel) {
          await this.generateLeaderboard(interaction.channel);
          await interaction.editReply({ content: '✅ Leaderboard generated and sent to this channel.' });
        } else {
          await this.generateLeaderboard();
          await interaction.editReply({ content: '✅ Leaderboard generated and sent to the tracked channel.' });
        }
      } catch (e: any) {
        await interaction.editReply({ content: `❌ Error: ${e.message}` });
      }
    } else if (commandName === 'ranks') {
      const sub = options.getSubcommand();
      if (sub === 'add') {
        const name = options.getString('name', true);
        const points = options.getInteger('points', true);
        const rank = await storage.createModRank({ name, requiredPoints: points });
        await interaction.reply({ content: `✅ Rank **${name}** added with ID **${rank.id}** (Requires **${points}** points).`, ephemeral: true });
      } else if (sub === 'modify') {
        const id = options.getInteger('id', true);
        const name = options.getString('name');
        const points = options.getInteger('points');
        
        const existing = await storage.getModRanks();
        const rank = existing.find(r => r.id === id);
        if (!rank) return interaction.reply({ content: `❌ Rank with ID **${id}** not found. Use \`/ranks list\` to see valid IDs.`, ephemeral: true });
        
        const updates: any = {};
        if (name) updates.name = name;
        if (points !== null) updates.requiredPoints = points;
        
        await storage.updateModRank(id, updates);
        await interaction.reply({ content: `✅ Rank **${id}** updated.`, ephemeral: true });
      } else if (sub === 'remove') {
        const id = options.getInteger('id', true);
        const existing = await storage.getModRanks();
        const rank = existing.find(r => r.id === id);
        if (!rank) return interaction.reply({ content: `❌ Rank with ID **${id}** not found.`, ephemeral: true });
        
        await storage.deleteModRank(id);
        await interaction.reply({ content: `✅ Rank **${id}** (**${rank.name}**) removed.`, ephemeral: true });
      } else if (sub === 'list') {
        const ranks = await storage.getModRanks();
        if (ranks.length === 0) return interaction.reply({ content: "No ranks configured. Use \`/ranks add\` to create one.", ephemeral: true });
        
        const embed = new EmbedBuilder()
          .setTitle("🎖 Configured Moderator Ranks")
          .setColor(0xd2a4bf)
          .setDescription(ranks.map(r => `ID: \`${r.id}\` | **${r.name}** | Points: \`${r.requiredPoints}\``).join('\n'))
          .setFooter({ text: "Use these IDs with modify/remove commands" });
          
        await interaction.reply({ embeds: [embed], ephemeral: true });
      }
    } else if (commandName === 'stats') {
      await interaction.deferReply();
      const user = options.getUser('user') || interaction.user;
      const mod = await storage.getModeratorByDiscordId(user.id);

      if (!mod) {
        return interaction.editReply({ content: `❌ No stats found for <@${user.id}>. Are they a tracked moderator?` });
      }

      const ptsPerMsg = parseInt(await storage.getSetting(SETTINGS_KEYS.POINTS_PER_MSG) || '15');
      const threshold = parseInt(await storage.getSetting(SETTINGS_KEYS.MESSAGE_THRESHOLD) || '1000');
      const ptsPerInvite = parseInt(await storage.getSetting(SETTINGS_KEYS.POINTS_PER_INVITE) || '1');
      const ptsPerVoiceHour = parseInt(await storage.getSetting(SETTINGS_KEYS.POINTS_PER_VOICE_HOUR) || '5');

      const msgPoints = Math.floor(mod.messageCount / threshold) * ptsPerMsg;
      const invitePoints = mod.inviteCount * ptsPerInvite;
      const voiceHours = Math.floor((mod.voiceMinutes || 0) / 60);
      const voicePoints = voiceHours * ptsPerVoiceHour;
      const totalPoints = msgPoints + invitePoints + voicePoints + mod.leaderboardPoints + mod.manualPoints;

      const allRanks = await storage.getModRanks();
      const sortedRanks = [...allRanks].sort((a, b) => b.requiredPoints - a.requiredPoints);
      const currentRank = sortedRanks.find(r => totalPoints >= r.requiredPoints);

      const embed = new EmbedBuilder()
        .setTitle(`Stats for ${user.username}`)
        .setThumbnail(user.displayAvatarURL())
        .addFields(
          // Row 1: raw counts
          { name: 'Messages', value: mod.messageCount.toString(), inline: true },
          { name: 'VC Hours', value: `${voiceHours}h`, inline: true },
          { name: 'Invites', value: mod.inviteCount.toString(), inline: true },
          // Row 2: points from each category
          { name: 'Pts (Messages)', value: msgPoints.toString(), inline: true },
          { name: 'Pts (VC)', value: voicePoints.toString(), inline: true },
          { name: 'Pts (Invites)', value: invitePoints.toString(), inline: true },
          // Row 3: bonus points
          { name: 'Pts (Manual)', value: mod.manualPoints.toString(), inline: true },
          { name: 'Pts (Leaderboard)', value: mod.leaderboardPoints.toString(), inline: true },
          { name: '\u200b', value: '\u200b', inline: true },
          // Row 4: total + rank
          { name: 'Total Points', value: `**${totalPoints}**`, inline: true },
          { name: 'Current Rank', value: currentRank ? `**${currentRank.name}**` : 'No rank yet', inline: true },
        )
        .setColor(0xd2a4bf);

      await interaction.editReply({ embeds: [embed] });
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

  public async generateLeaderboard(targetChannel?: TextChannel) {
    const channel = targetChannel || await (async () => {
      const trackedChannelId = await storage.getSetting(SETTINGS_KEYS.TRACKED_CHANNEL_ID);
      if (!trackedChannelId) throw new Error("Tracked channel not set");
      const c = await this.client.channels.fetch(trackedChannelId);
      if (!c || !(c instanceof TextChannel)) throw new Error("Invalid tracked channel");
      return c;
    })();

    const moderators = await storage.getModerators();
    const ranks = await storage.getModRanks();
    const modRoleId = await storage.getSetting(SETTINGS_KEYS.MODERATOR_ROLE_ID);
    
    // Filter active mods (must be in guild and have role)
    const activeMods = [];
    if (modRoleId) {
      for (const m of moderators) {
        if (m.isIgnored) continue;
        try {
          const guild = channel.guild;
          const member = await guild.members.fetch(m.discordId).catch(() => null);
          if (member && member.roles.cache.has(modRoleId)) {
            activeMods.push(m);
          }
        } catch (e) {
          // Member likely left or role check failed
        }
      }
    } else {
      activeMods.push(...moderators.filter(m => !m.isIgnored));
    }

    const ptsPerMsg = parseInt(await storage.getSetting(SETTINGS_KEYS.POINTS_PER_MSG) || '15');
    const threshold = parseInt(await storage.getSetting(SETTINGS_KEYS.MESSAGE_THRESHOLD) || '1000');
    const ptsPerInvite = parseInt(await storage.getSetting(SETTINGS_KEYS.POINTS_PER_INVITE) || '1');
    const ptsPerVoiceHour = parseInt(await storage.getSetting(SETTINGS_KEYS.POINTS_PER_VOICE_HOUR) || '5');

    const modsWithStats = activeMods.map(m => {
      const msgPoints = Math.floor(m.messageCount / threshold) * ptsPerMsg;
      const invitePoints = m.inviteCount * ptsPerInvite;
      const voiceHours = Math.floor((m.voiceMinutes || 0) / 60);
      const voicePoints = voiceHours * ptsPerVoiceHour;
      const totalPoints = msgPoints + invitePoints + voicePoints + m.leaderboardPoints + m.manualPoints;
      return { ...m, msgPoints, invitePoints, voiceHours, voicePoints, totalPoints };
    });

    const rankedTotal = [...modsWithStats].sort((a, b) => b.totalPoints - a.totalPoints);

    const totalEmbed = new EmbedBuilder()
      .setTitle("Moderator Leaderboard")
      .setColor(0xd2a4bf)
      .setTimestamp();

    let totalDesc = "";
    rankedTotal.forEach((m, i) => {
      const achievedRank = [...ranks].reverse().find(r => m.totalPoints >= r.requiredPoints);
      const rankDisplay = achievedRank ? ` [**${achievedRank.name}**]` : "";

      totalDesc += `**#${i + 1}** <@${m.discordId}>${rankDisplay}\n` +
        `╰ Points: **${m.totalPoints}**\n` +
        `╰ ${m.messageCount} msgs (${m.msgPoints} pts) · ${m.inviteCount} invites (${m.invitePoints} pts) · ${m.voiceHours}h VC (${m.voicePoints} pts)\n\n`;
    });
    totalEmbed.setDescription(totalDesc || "No activity.");

    await channel.send({ embeds: [totalEmbed] });
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
