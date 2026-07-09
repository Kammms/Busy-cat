import { 
  Client, 
  GatewayIntentBits, 
  Partials, 
  Collection, 
  EmbedBuilder, 
  TextChannel, 
  SlashCommandBuilder, 
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ComponentType,
  REST, 
  Routes, 
  PermissionFlagsBits,
  MessageFlags,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  AuditLogEvent,
  Invite
} from 'discord.js';
import { storage } from './storage';
import { SETTINGS_KEYS } from '@shared/schema';

// ── Shop ────────────────────────────────────────────────────────────────────
const SHOP_ITEMS = [
  { id: 'custom_role',        label: '🎨 Custom Role',              desc: 'A custom coloured role for 1 week',      durationDays: 7  },
  { id: 'role_icon',          label: '🖼️ Role Icon',                desc: 'Add an icon to your custom role',        durationDays: 7  },
  { id: 'role_name',          label: '✏️ Change Role Name',         desc: 'Rename your custom role',               durationDays: 7  },
  { id: 'role_share',         label: '🤝 Share Role',               desc: 'Let someone else also have your role',  durationDays: 7  },
  { id: 'booster_role_share', label: '✨ Share a Booster Role',     desc: 'Share a booster role for 1 month',       durationDays: 30 },
  { id: 'autoreact',          label: '⚡ Autoreact',                desc: 'Bot reacts to your messages',            durationDays: 7  },
  { id: 'autoreply',          label: '💬 Autoreply',                desc: 'Bot replies to your messages',           durationDays: 7  },
  { id: 'mute_member',        label: '🔇 Mute a Member (5 min)',    desc: 'Temporarily mute someone for 5 minutes', durationDays: 7  },
  { id: 'rename_member',      label: '📝 Rename a Member',          desc: 'Change someone\'s server nickname',      durationDays: 7  },
] as const;

type ShopItemId = (typeof SHOP_ITEMS)[number]['id'];

const DEFAULT_PRICES: Record<ShopItemId, { msg: number; vc: number }> = {
  custom_role:        { msg: 2000, vc: 6  },
  role_icon:          { msg: 500,  vc: 1  },
  role_name:          { msg: 500,  vc: 1  },
  role_share:         { msg: 1000, vc: 2  },
  booster_role_share: { msg: 1500, vc: 5  },
  autoreact:          { msg: 2000, vc: 5  },
  autoreply:          { msg: 3000, vc: 6  },
  mute_member:        { msg: 5000, vc: 15 },
  rename_member:      { msg: 5000, vc: 15 },
};

async function getShopPrices(): Promise<Record<ShopItemId, { msg: number; vc: number }>> {
  const raw = await storage.getSetting(SETTINGS_KEYS.SHOP_PRICES);
  if (!raw) return { ...DEFAULT_PRICES };
  try {
    return { ...DEFAULT_PRICES, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PRICES };
  }
}
// ────────────────────────────────────────────────────────────────────────────

// Minimal Invite interface for caching
interface CachedInvite {
  code: string;
  uses: number;
  inviterId: string | null;
}

interface PendingShopPurchase {
  originalInteraction: ChatInputCommandInteraction;
  buyerId: string;
  buyerUsername: string;
  selectedIds: ShopItemId[];
  totalMsg: number;
  totalVc: number;
  paymentType: 'msg' | 'vc';
  aboveRoleId?: string;
  expiresAt: Date;
}

export class DiscordBot {
  private client: Client;
  private inviteCache: Collection<string, Collection<string, CachedInvite>> = new Collection();
  private isReady: boolean = false;
  private voiceJoinTimes: Map<string, number> = new Map();
  private pendingShopPurchases = new Map<string, PendingShopPurchase>();

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
                    `<@${newMember.id}> just tried to switch from <@&${oldGenderRole}> to <@&${newGenderRole}> just to lurk in the <@&${newGenderRole}> channel. 💀`
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
                  .setTitle(minorToAdult ? '🔞 Nice Try' : '👀 Caught in 4K')
                  .setDescription(
                    minorToAdult
                      ? `<@${newMember.id}> just tried to swap their <@&${oldMinorRole}> role for <@&${ageAdultRoleId}> to sneak into the adult channel. 💀\n\nNot today.`
                      : `<@${newMember.id}> just tried to switch from <@&${oldMinorRole}> to <@&${newMinorRole}> 👀 Can't change your age that easily. 💀`
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

      // ── Shop role expiry checker (runs every 5 minutes) ─────────────────
      const checkExpiredRoles = async () => {
        try {
          const expired = await storage.getExpiredShopRoles();
          for (const sr of expired) {
            const guild = this.client.guilds.cache.get(sr.guildId);
            if (!guild) { await storage.markShopRoleExpired(sr.id); continue; }
            const role = guild.roles.cache.get(sr.roleId) ?? await guild.roles.fetch(sr.roleId).catch(() => null);
            if (role) {
              try {
                // Remove all members from this role
                const membersWithRole = guild.members.cache.filter(m => m.roles.cache.has(role.id));
                for (const m of membersWithRole.values()) {
                  await m.roles.remove(role).catch(() => {});
                }
                // Reset role to grey, no icon, no name suffix
                await role.edit({ color: 0x808080, unicodeEmoji: null, reason: 'Shop role expired (1 week)' }).catch(() => {});
              } catch (e) {
                console.error(`Failed to expire shop role ${role.id}:`, e);
              }
            }
            await storage.markShopRoleExpired(sr.id);
            console.log(`Expired shop role ${sr.roleId} for buyer ${sr.buyerDiscordId}`);
          }
        } catch (e) {
          console.error('Shop expiry check failed:', e);
        }
      };

      setInterval(checkExpiredRoles, 5 * 60 * 1000);
      checkExpiredRoles(); // run once on startup too
      // ────────────────────────────────────────────────────────────────────
    });

    this.client.on('interactionCreate', async (interaction) => {
      if (interaction.isChatInputCommand()) {
        try {
          await this.handleInteraction(interaction);
        } catch (err) {
          console.error('Unhandled interaction error:', err);
          try {
            const msg = { content: '❌ Something went wrong.', flags: MessageFlags.Ephemeral };
            if (interaction.replied || interaction.deferred) {
              await interaction.followUp(msg);
            } else {
              await interaction.reply(msg);
            }
          } catch {}
        }
      } else if (interaction.isModalSubmit()) {
        try {
          await this.handleShopModalSubmit(interaction);
        } catch (err) {
          console.error('Unhandled modal error:', err);
          try {
            if (interaction.replied || interaction.deferred) {
              await interaction.followUp({ content: '❌ Something went wrong.', flags: MessageFlags.Ephemeral });
            } else {
              await interaction.reply({ content: '❌ Something went wrong.', flags: MessageFlags.Ephemeral });
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
        )
        .addSubcommand(sub =>
          sub.setName('shop')
            .setDescription('Configure the shop system')
            .addRoleOption(opt => opt.setName('allowed_role').setDescription('Role whose members can run /shop buy').setRequired(false))
            .addChannelOption(opt => opt.setName('channel').setDescription('Channel where receipts are posted').setRequired(false))
            .addRoleOption(opt => opt.setName('above_role').setDescription('New custom roles are placed just above this role').setRequired(false))
        )
        .addSubcommand(sub =>
          sub.setName('shop-price')
            .setDescription('Set the price of a shop item')
            .addStringOption(opt => opt.setName('item').setDescription('Which item to price')
              .setRequired(true)
              .addChoices(
                { name: '🎨 Custom Role',           value: 'custom_role'        },
                { name: '🖼️ Role Icon',             value: 'role_icon'          },
                { name: '✏️ Change Role Name',      value: 'role_name'          },
                { name: '🤝 Share Role',            value: 'role_share'         },
                { name: '✨ Share a Booster Role',  value: 'booster_role_share' },
                { name: '⚡ Autoreact',             value: 'autoreact'          },
                { name: '💬 Autoreply',             value: 'autoreply'          },
                { name: '🔇 Mute a Member (5 min)', value: 'mute_member'        },
                { name: '📝 Rename a Member',       value: 'rename_member'      },
              ))
            .addIntegerOption(opt => opt.setName('messages').setDescription('Weekly message cost').setRequired(false).setMinValue(0))
            .addIntegerOption(opt => opt.setName('vc_hours').setDescription('Weekly VC hours cost').setRequired(false).setMinValue(0))
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
        .setName('say')
        .setDescription('Make the bot send a message')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt => opt.setName('message').setDescription('The message content').setRequired(true))
        .addChannelOption(opt => opt.setName('channel').setDescription('Channel to send to (defaults to current channel)').setRequired(false))
        .addBooleanOption(opt => opt.setName('mention_sender').setDescription('Prefix the message with "user said:"').setRequired(false)),
      new SlashCommandBuilder()
        .setName('servers')
        .setDescription('List all servers using this bot with invite links')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
      new SlashCommandBuilder()
        .setName('inrole')
        .setDescription('List members that have all of the specified roles')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addRoleOption(opt => opt.setName('role1').setDescription('First role').setRequired(true))
        .addRoleOption(opt => opt.setName('role2').setDescription('Second role (optional)').setRequired(false))
        .addRoleOption(opt => opt.setName('role3').setDescription('Third role (optional)').setRequired(false)),
      new SlashCommandBuilder()
        .setName('shop')
        .setDescription('Shop management')
        .addSubcommand(sub =>
          sub.setName('buy')
            .setDescription('Record a purchase for a member')
            .addUserOption(opt => opt.setName('buyer').setDescription('Who is buying').setRequired(true))
            .addRoleOption(opt => opt.setName('above_role').setDescription('Place new custom role above this role (overrides server default)').setRequired(false))
        )
        .addSubcommand(sub =>
          sub.setName('stats')
            .setDescription('View shop statistics and transaction history')
        ),
      new SlashCommandBuilder()
        .setName('search')
        .setDescription('Find members with certain roles who mentioned/replied to a user')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(opt => opt.setName('user').setDescription('The user who was mentioned or replied to').setRequired(true))
        .addChannelOption(opt => opt.setName('channel').setDescription('Channel to search through').setRequired(true))
        .addRoleOption(opt => opt.setName('role1').setDescription('First role the sender must have').setRequired(true))
        .addRoleOption(opt => opt.setName('role2').setDescription('Second role the sender must also have (optional)').setRequired(false))
        .addChannelOption(opt => opt.setName('send_to').setDescription('Channel to send results to (defaults to current channel)').setRequired(false))
        .addIntegerOption(opt => opt.setName('limit').setDescription('How many messages to scan (default 500, max 1000)').setMinValue(100).setMaxValue(1000).setRequired(false)),
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
        await interaction.reply({ content: `✅ Moderator team role set to <@&${role.id}>`, flags: MessageFlags.Ephemeral });
      } else if (sub === 'track') {
        const channel = options.getChannel('channel', true);
        await storage.updateSetting(SETTINGS_KEYS.TRACKED_CHANNEL_ID, channel.id);
        await interaction.reply({ content: `✅ Tracking channel set to <#${channel.id}>`, flags: MessageFlags.Ephemeral });
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
          flags: MessageFlags.Ephemeral,
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
          flags: MessageFlags.Ephemeral,
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
        
        await interaction.reply({ content: `✅ Point values updated.`, flags: MessageFlags.Ephemeral });
      } else if (sub === 'shop') {
        const allowedRole = options.getRole('allowed_role');
        const channel = options.getChannel('channel');
        const aboveRole = options.getRole('above_role');
        if (allowedRole) await storage.updateSetting(SETTINGS_KEYS.SHOP_ALLOWED_ROLE_ID, allowedRole.id);
        if (channel) await storage.updateSetting(SETTINGS_KEYS.SHOP_CHANNEL_ID, channel.id);
        if (aboveRole) await storage.updateSetting(SETTINGS_KEYS.SHOP_ABOVE_ROLE_ID, aboveRole.id);
        const aRoleId = await storage.getSetting(SETTINGS_KEYS.SHOP_ALLOWED_ROLE_ID);
        const chId = await storage.getSetting(SETTINGS_KEYS.SHOP_CHANNEL_ID);
        const abvId = await storage.getSetting(SETTINGS_KEYS.SHOP_ABOVE_ROLE_ID);
        await interaction.reply({
          content: `✅ Shop configured.\n**Allowed role:** ${aRoleId ? `<@&${aRoleId}>` : 'Not set'}\n**Receipt channel:** ${chId ? `<#${chId}>` : 'Not set'}\n**Place roles above:** ${abvId ? `<@&${abvId}>` : 'Not set'}`,
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'shop-price') {
        const itemId = options.getString('item', true) as ShopItemId;
        const msgs = options.getInteger('messages');
        const vcHours = options.getInteger('vc_hours');
        const prices = await getShopPrices();
        if (msgs !== null) prices[itemId].msg = msgs;
        if (vcHours !== null) prices[itemId].vc = vcHours;
        await storage.updateSetting(SETTINGS_KEYS.SHOP_PRICES, JSON.stringify(prices));
        const item = SHOP_ITEMS.find(i => i.id === itemId)!;
        await interaction.reply({
          content: `✅ **${item.label}** price updated: **${prices[itemId].msg.toLocaleString()} messages** or **${prices[itemId].vc}h VC**`,
          flags: MessageFlags.Ephemeral,
        });
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
      
      await interaction.reply({ content: `✅ <@${user.id}> has been excluded from tracking.`, flags: MessageFlags.Ephemeral });
    } else if (commandName === 'include') {
      const user = options.getUser('user', true);
      let moderator = await storage.getModeratorByDiscordId(user.id);
      
      if (moderator) {
        await storage.updateModerator(moderator.id, { isIgnored: false });
        await interaction.reply({ content: `✅ <@${user.id}> has been included back in tracking.`, flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: `❌ <@${user.id}> is not in the system. They will be added automatically when they send a message in the tracked channel.`, flags: MessageFlags.Ephemeral });
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
        return interaction.reply({ content: "❌ This user is not a tracked moderator.", flags: MessageFlags.Ephemeral });
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
        if (amount === null) return interaction.reply({ content: '❌ Please provide an `amount` for this type.', flags: MessageFlags.Ephemeral });
        await storage.updateModerator(mod.id, { messageCount: Math.max(0, mod.messageCount + amount) });
        await interaction.reply({ content: `✅ Adjusted message count for <@${user.id}> by **${amount}**.` });
      } else if (type === 'invites') {
        if (amount === null) return interaction.reply({ content: '❌ Please provide an `amount` for this type.', flags: MessageFlags.Ephemeral });
        await storage.updateModerator(mod.id, { inviteCount: Math.max(0, mod.inviteCount + amount) });
        await interaction.reply({ content: `✅ Adjusted invite count for <@${user.id}> by **${amount}**.` });
      } else if (type === 'voicehours') {
        if (amount === null) return interaction.reply({ content: '❌ Please provide an `amount` for this type.', flags: MessageFlags.Ephemeral });
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
          return interaction.reply({ content: '❌ Please provide either a `rank` or an `amount` for leaderboard points.', flags: MessageFlags.Ephemeral });
        }

        await storage.updateModerator(mod.id, { leaderboardPoints: Math.max(0, mod.leaderboardPoints + pointsToAdd) });
        await interaction.reply({ content: `✅ Added **${label}** of leaderboard points to <@${user.id}>.` });
      }
    } else if (commandName === 'balance') {
      const mod = await storage.getModeratorByDiscordId(interaction.user.id);
      if (!mod) {
        return interaction.reply({ content: "❌ You are not a tracked moderator.", flags: MessageFlags.Ephemeral });
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
    } else if (commandName === 'inrole') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const role1 = options.getRole('role1', true);
        const role2 = options.getRole('role2');
        const role3 = options.getRole('role3');
        const requiredRoleIds = [role1.id, role2?.id, role3?.id].filter(Boolean) as string[];

        try {
          await interaction.guild!.members.fetch();
        } catch (fetchErr) {
          console.error('members.fetch() failed (Server Members Intent may not be enabled):', fetchErr);
          await interaction.editReply({
            content: '❌ Could not fetch members. Make sure the **Server Members Intent** is enabled in the Discord Developer Portal under your bot → Bot → Privileged Gateway Intents.',
          });
          return;
        }

        const matching = interaction.guild!.members.cache.filter(m =>
          requiredRoleIds.every(id => m.roles.cache.has(id))
        );

        const roleLabels = requiredRoleIds.map(id => `<@&${id}>`).join(' + ');
        if (matching.size === 0) {
          await interaction.editReply({ content: `No members found with all of: ${roleLabels}` });
          return;
        }

        const allLines = [...matching.values()]
          .sort((a, b) => a.user.username.localeCompare(b.user.username))
          .map(m => `<@${m.id}> (${m.user.username})`);

        const PAGE_SIZE = 20;
        const pages: string[] = [];
        for (let i = 0; i < allLines.length; i += PAGE_SIZE) {
          pages.push(allLines.slice(i, i + PAGE_SIZE).join('\n'));
        }

        const buildEmbed = (page: number) => new EmbedBuilder()
          .setTitle(`👥 Members with ${roleLabels} (${matching.size})`)
          .setDescription(pages[page])
          .setFooter({ text: `Page ${page + 1} of ${pages.length}` })
          .setColor(0xd2a4bf);

        const buildRow = (page: number) => new ActionRowBuilder<ButtonBuilder>()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('inrole_prev')
              .setLabel('◀ Previous')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(page === 0),
            new ButtonBuilder()
              .setCustomId('inrole_next')
              .setLabel('Next ▶')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(page === pages.length - 1),
          );

        const response = await interaction.editReply({
          embeds: [buildEmbed(0)],
          components: pages.length > 1 ? [buildRow(0)] : [],
        });

        if (pages.length <= 1) return;

        let currentPage = 0;
        const collector = response.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 5 * 60 * 1000,
        });

        collector.on('collect', async (btn) => {
          if (btn.user.id !== interaction.user.id) {
            await btn.reply({ content: "These buttons aren't for you.", flags: MessageFlags.Ephemeral });
            return;
          }
          if (btn.customId === 'inrole_prev') currentPage = Math.max(0, currentPage - 1);
          if (btn.customId === 'inrole_next') currentPage = Math.min(pages.length - 1, currentPage + 1);
          await btn.update({ embeds: [buildEmbed(currentPage)], components: [buildRow(currentPage)] });
        });

        collector.on('end', async () => {
          try {
            const disabledRow = new ActionRowBuilder<ButtonBuilder>()
              .addComponents(
                new ButtonBuilder().setCustomId('inrole_prev').setLabel('◀ Previous').setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId('inrole_next').setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(true),
              );
            await interaction.editReply({ components: [disabledRow] });
          } catch {}
        });

      } catch (err) {
        console.error('Error in /inrole:', err);
        await interaction.editReply({ content: '❌ Failed to fetch members. Make sure the bot has the right permissions.' });
      }
    } else if (commandName === 'shop') {
      const sub = options.getSubcommand();
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      // Permission check — allowed role or Administrator
      const shopAllowedRoleId = await storage.getSetting(SETTINGS_KEYS.SHOP_ALLOWED_ROLE_ID);
      const member = interaction.guild!.members.cache.get(interaction.user.id)
        ?? await interaction.guild!.members.fetch(interaction.user.id).catch(() => null);
      const isAdmin = member?.permissions.has(PermissionFlagsBits.Administrator) ?? false;
      const hasShopRole = shopAllowedRoleId ? (member?.roles.cache.has(shopAllowedRoleId) ?? false) : false;
      if (!isAdmin && !hasShopRole) {
        await interaction.editReply({ content: '❌ You don\'t have permission to use shop commands.' });
        return;
      }

      if (sub === 'buy') {
        const buyer = options.getUser('buyer', true);
        const aboveRoleOpt = options.getRole('above_role');

        const prices = await getShopPrices();

        // Build select menu with prices shown
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId(`shop_items_${interaction.user.id}`)
          .setPlaceholder('Select one or more items…')
          .setMinValues(1)
          .setMaxValues(SHOP_ITEMS.length)
          .addOptions(SHOP_ITEMS.map(item =>
            new StringSelectMenuOptionBuilder()
              .setLabel(item.label)
              .setValue(item.id)
              .setDescription(`${prices[item.id].msg.toLocaleString()} msgs or ${prices[item.id].vc}h VC`)
          ));

        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

        const response = await interaction.editReply({
          content: `🛒 Select items for **${buyer.username}**:`,
          components: [row],
        });

        const collector = response.createMessageComponentCollector({
          componentType: ComponentType.StringSelect,
          time: 5 * 60 * 1000,
          max: 1,
        });

        collector.on('collect', async (sel) => {
          if (sel.user.id !== interaction.user.id) {
            await sel.reply({ content: "This isn't for you.", flags: MessageFlags.Ephemeral });
            return;
          }

          await sel.deferUpdate();

          const selectedIds = sel.values as ShopItemId[];
          let totalMsg = 0;
          let totalVc = 0;
          for (const id of selectedIds) {
            totalMsg += prices[id].msg;
            totalVc += prices[id].vc;
          }

          const maxDurationDays = selectedIds.reduce((max, id) => {
            const days = SHOP_ITEMS.find(i => i.id === id)?.durationDays ?? 7;
            return Math.max(max, days);
          }, 7);
          const expiresAt = new Date(Date.now() + maxDurationDays * 24 * 60 * 60 * 1000);

          const itemLines = selectedIds.map(id => {
            const item = SHOP_ITEMS.find(i => i.id === id)!;
            const dur = item.durationDays === 30 ? '1 month' : '1 week';
            return `• ${item.label} *(${dur})* — ${prices[id].msg.toLocaleString()} msgs / ${prices[id].vc}h VC`;
          }).join('\n');

          const summaryEmbed = new EmbedBuilder()
            .setTitle('🛒 Choose Payment Method')
            .setDescription(`**Buyer:** <@${buyer.id}>\n\n**Items:**\n${itemLines}\n\n**Cost:** ${totalMsg.toLocaleString()} messages **or** ${totalVc}h of VC`)
            .setColor(0xd2a4bf)
            .setFooter({ text: 'Select how the buyer is paying — you\'ll enter their balance next.' });

          const payRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('shop_pay_msg').setLabel(`💬 Messages (${totalMsg.toLocaleString()})`).setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('shop_pay_vc').setLabel(`🎤 VC Hours (${totalVc}h)`).setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('shop_cancel').setLabel('❌ Cancel').setStyle(ButtonStyle.Secondary),
          );

          await interaction.editReply({ content: '', embeds: [summaryEmbed], components: [payRow] });

          const btnCollector = response.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 2 * 60 * 1000,
            max: 1,
          });

          btnCollector.on('collect', async (btn) => {
            if (btn.user.id !== interaction.user.id) {
              await btn.reply({ content: "This isn't for you.", flags: MessageFlags.Ephemeral });
              return;
            }

            if (btn.customId === 'shop_cancel') {
              await btn.deferUpdate();
              await interaction.editReply({ content: '❌ Purchase cancelled.', embeds: [], components: [] });
              return;
            }

            const paymentType: 'msg' | 'vc' = btn.customId === 'shop_pay_msg' ? 'msg' : 'vc';
            const paymentLabel = paymentType === 'msg' ? 'messages' : 'VC hours';
            const costAmount = paymentType === 'msg' ? totalMsg : totalVc;

            // Store state for modal submit
            this.pendingShopPurchases.set(interaction.user.id, {
              originalInteraction: interaction,
              buyerId: buyer.id,
              buyerUsername: buyer.username,
              selectedIds,
              totalMsg,
              totalVc,
              paymentType,
              aboveRoleId: aboveRoleOpt?.id,
              expiresAt,
            });

            const modal = new ModalBuilder()
              .setCustomId('shop_balance_modal')
              .setTitle('Buyer Balance')
              .addComponents(
                new ActionRowBuilder<TextInputBuilder>().addComponents(
                  new TextInputBuilder()
                    .setCustomId('buyer_balance')
                    .setLabel(`How many ${paymentLabel} did ${buyer.username} have?`)
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder(`e.g. ${(costAmount * 2).toLocaleString()}`)
                    .setRequired(true)
                )
              );

            await btn.showModal(modal);
          });

          btnCollector.on('end', async (collected) => {
            if (collected.size === 0) {
              await interaction.editReply({ content: '⏱️ Timed out.', embeds: [], components: [] }).catch(() => {});
            }
          });
        });

        collector.on('end', async (collected) => {
          if (collected.size === 0) {
            await interaction.editReply({ content: '⏱️ Timed out — no items selected.', components: [] }).catch(() => {});
          }
        });

      } else if (sub === 'stats') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const guildId = interaction.guildId!;
        const txs = await storage.getShopTransactions(guildId, 100);

        if (txs.length === 0) {
          await interaction.editReply({ content: '📊 No transactions recorded yet.' });
          return;
        }

        // Sales by item
        const salesByItem: Record<string, number> = {};
        const buyerCounts: Record<string, { username: string; count: number }> = {};

        for (const tx of txs) {
          for (const item of tx.items) {
            salesByItem[item] = (salesByItem[item] ?? 0) + 1;
          }
          if (buyerCounts[tx.buyerDiscordId]) {
            buyerCounts[tx.buyerDiscordId].count++;
          } else {
            buyerCounts[tx.buyerDiscordId] = { username: tx.buyerUsername, count: 1 };
          }
        }

        const itemSalesLines = SHOP_ITEMS
          .map(i => `${i.label}: **${salesByItem[i.id] ?? 0}**`)
          .join('\n');

        const topBuyers = Object.entries(buyerCounts)
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, 10)
          .map(([id, v], i) => `**#${i + 1}** <@${id}> (${v.username}) — ${v.count} purchase${v.count !== 1 ? 's' : ''}`)
          .join('\n');

        const recentLines = txs.slice(0, 10).map(tx => {
          const itemNames = tx.items.map(id => SHOP_ITEMS.find(i => i.id === id)?.label ?? id).join(', ');
          return `<@${tx.buyerDiscordId}> — ${itemNames} — <t:${Math.floor(tx.purchasedAt.getTime() / 1000)}:R>`;
        }).join('\n');

        const embed = new EmbedBuilder()
          .setTitle('📊 Shop Statistics')
          .addFields(
            { name: '🗓️ Recent Transactions (last 10)', value: recentLines || 'None' },
            { name: '🛍️ Sales by Item', value: itemSalesLines },
            { name: '👑 Top Buyers', value: topBuyers || 'None' },
          )
          .setFooter({ text: `${txs.length} total transactions` })
          .setColor(0xd2a4bf)
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      }
    } else if (commandName === 'search') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const targetUser = options.getUser('user', true);
        const searchChannel = options.getChannel('channel', true);
        const role1 = options.getRole('role1', true);
        const role2 = options.getRole('role2');
        const sendToChannel = options.getChannel('send_to');
        const scanLimit = options.getInteger('limit') ?? 500;

        if (!(searchChannel instanceof TextChannel)) {
          await interaction.editReply({ content: '❌ The search channel must be a text channel.' });
          return;
        }

        const outputChannel = (sendToChannel instanceof TextChannel ? sendToChannel : interaction.channel) as TextChannel;

        // Fetch all members so role cache is populated
        await interaction.guild!.members.fetch().catch(() => {});

        await interaction.editReply({ content: `🔍 Scanning up to **${scanLimit}** messages in <#${searchChannel.id}>...` });

        // Fetch messages in batches of 100
        const requiredRoleIds = [role1.id, role2?.id].filter(Boolean) as string[];
        const matchingSenders = new Map<string, { member: any; messageLink: string; count: number }>();

        let lastId: string | undefined;
        let scanned = 0;

        while (scanned < scanLimit) {
          const batch = await searchChannel.messages.fetch({ limit: 100, ...(lastId ? { before: lastId } : {}) });
          if (batch.size === 0) break;

          for (const msg of batch.values()) {
            if (msg.author.bot) continue;

            // Check if this message mentions or replies to the target user
            const mentionsTarget = msg.mentions.users.has(targetUser.id);
            const repliesToTarget = msg.reference?.messageId
              ? (await searchChannel.messages.fetch(msg.reference.messageId).catch(() => null))?.author?.id === targetUser.id
              : false;

            if (!mentionsTarget && !repliesToTarget) continue;

            // Check sender has required roles
            const sender = interaction.guild!.members.cache.get(msg.author.id);
            if (!sender) continue;
            if (!requiredRoleIds.every(id => sender.roles.cache.has(id))) continue;

            const messageLink = `https://discord.com/channels/${interaction.guildId}/${searchChannel.id}/${msg.id}`;
            if (matchingSenders.has(msg.author.id)) {
              matchingSenders.get(msg.author.id)!.count++;
            } else {
              matchingSenders.set(msg.author.id, { member: sender, messageLink, count: 1 });
            }
          }

          lastId = batch.last()?.id;
          scanned += batch.size;
          if (batch.size < 100) break;
        }

        const roleLabels = requiredRoleIds.map(id => `<@&${id}>`).join(' + ');

        if (matchingSenders.size === 0) {
          await interaction.editReply({ content: `✅ Done. No members with ${roleLabels} mentioned or replied to <@${targetUser.id}> in the last **${scanned}** messages.` });
          return;
        }

        // Build paginated results
        const allLines = [...matchingSenders.values()]
          .sort((a, b) => b.count - a.count)
          .map(({ member, messageLink, count }) =>
            `<@${member.id}> (${member.user.username}) — **${count}** time${count !== 1 ? 's' : ''} — [example](${messageLink})`
          );

        const PAGE_SIZE = 15;
        const pages: string[] = [];
        for (let i = 0; i < allLines.length; i += PAGE_SIZE) {
          pages.push(allLines.slice(i, i + PAGE_SIZE).join('\n'));
        }

        const buildEmbed = (page: number) => new EmbedBuilder()
          .setTitle(`🔎 Who mentioned/replied to ${targetUser.username} (${matchingSenders.size} found)`)
          .setDescription(pages[page])
          .setFooter({ text: `Roles: ${requiredRoleIds.map(id => `@${interaction.guild!.roles.cache.get(id)?.name ?? id}`).join(' + ')} • Scanned ${scanned} messages • Page ${page + 1}/${pages.length}` })
          .setColor(0xd2a4bf);

        const buildRow = (page: number) => new ActionRowBuilder<ButtonBuilder>()
          .addComponents(
            new ButtonBuilder().setCustomId('search_prev').setLabel('◀ Previous').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
            new ButtonBuilder().setCustomId('search_next').setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(page === pages.length - 1),
          );

        const sent = await outputChannel.send({
          embeds: [buildEmbed(0)],
          components: pages.length > 1 ? [buildRow(0)] : [],
        });

        await interaction.editReply({ content: `✅ Results sent to <#${outputChannel.id}>.` });

        if (pages.length <= 1) return;

        let currentPage = 0;
        const collector = sent.createMessageComponentCollector({ componentType: ComponentType.Button, time: 5 * 60 * 1000 });

        collector.on('collect', async (btn) => {
          if (btn.customId === 'search_prev') currentPage = Math.max(0, currentPage - 1);
          if (btn.customId === 'search_next') currentPage = Math.min(pages.length - 1, currentPage + 1);
          await btn.update({ embeds: [buildEmbed(currentPage)], components: [buildRow(currentPage)] });
        });

        collector.on('end', async () => {
          try {
            const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder().setCustomId('search_prev').setLabel('◀ Previous').setStyle(ButtonStyle.Secondary).setDisabled(true),
              new ButtonBuilder().setCustomId('search_next').setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(true),
            );
            await sent.edit({ components: [disabledRow] });
          } catch {}
        });

      } catch (err) {
        console.error('Error in /search:', err);
        await interaction.editReply({ content: '❌ Something went wrong during the search.' });
      }
    } else if (commandName === 'say') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const message = options.getString('message', true);
      const targetChannel = (options.getChannel('channel') as TextChannel | null) ?? (interaction.channel as TextChannel);
      const mentionSender = options.getBoolean('mention_sender') ?? false;

      if (!targetChannel || !targetChannel.isTextBased()) {
        await interaction.editReply({ content: '❌ Invalid channel.' });
        return;
      }

      const content = mentionSender
        ? `${interaction.user} said: ${message}`
        : message;

      try {
        await targetChannel.send({ content });
        await interaction.editReply({ content: `✅ Message sent to <#${targetChannel.id}>.` });
      } catch (err) {
        console.error('Failed to send /say message:', err);
        await interaction.editReply({ content: "❌ Couldn't send the message. Check my permissions in that channel." });
      }
    } else if (commandName === 'servers') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const guilds = this.client.guilds.cache;
      const lines: string[] = [];

      for (const guild of guilds.values()) {
        try {
          const channel = guild.channels.cache.find(
            c => c instanceof TextChannel && c.permissionsFor(guild.members.me!)?.has('CreateInstantInvite')
          ) as TextChannel | undefined;

          if (channel) {
            const invite = await channel.createInvite({ maxAge: 0, maxUses: 0, reason: '/servers command' });
            lines.push(`**${guild.name}** (${guild.memberCount} members)\n${invite.url}`);
          } else {
            lines.push(`**${guild.name}** (${guild.memberCount} members)\n*No channel available for invite*`);
          }
        } catch {
          lines.push(`**${guild.name}** (${guild.memberCount} members)\n*Could not generate invite*`);
        }
      }

      const embed = new EmbedBuilder()
        .setTitle(`🌐 Servers using this bot (${guilds.size})`)
        .setDescription(lines.join('\n\n') || 'No servers found.')
        .setColor(0xd2a4bf)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } else if (commandName === 'leaderboard') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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
        await interaction.reply({ content: `✅ Rank **${name}** added with ID **${rank.id}** (Requires **${points}** points).`, flags: MessageFlags.Ephemeral });
      } else if (sub === 'modify') {
        const id = options.getInteger('id', true);
        const name = options.getString('name');
        const points = options.getInteger('points');
        
        const existing = await storage.getModRanks();
        const rank = existing.find(r => r.id === id);
        if (!rank) return interaction.reply({ content: `❌ Rank with ID **${id}** not found. Use \`/ranks list\` to see valid IDs.`, flags: MessageFlags.Ephemeral });
        
        const updates: any = {};
        if (name) updates.name = name;
        if (points !== null) updates.requiredPoints = points;
        
        await storage.updateModRank(id, updates);
        await interaction.reply({ content: `✅ Rank **${id}** updated.`, flags: MessageFlags.Ephemeral });
      } else if (sub === 'remove') {
        const id = options.getInteger('id', true);
        const existing = await storage.getModRanks();
        const rank = existing.find(r => r.id === id);
        if (!rank) return interaction.reply({ content: `❌ Rank with ID **${id}** not found.`, flags: MessageFlags.Ephemeral });
        
        await storage.deleteModRank(id);
        await interaction.reply({ content: `✅ Rank **${id}** (**${rank.name}**) removed.`, flags: MessageFlags.Ephemeral });
      } else if (sub === 'list') {
        const ranks = await storage.getModRanks();
        if (ranks.length === 0) return interaction.reply({ content: "No ranks configured. Use \`/ranks add\` to create one.", flags: MessageFlags.Ephemeral });
        
        const embed = new EmbedBuilder()
          .setTitle("🎖 Configured Moderator Ranks")
          .setColor(0xd2a4bf)
          .setDescription(ranks.map(r => `ID: \`${r.id}\` | **${r.name}** | Points: \`${r.requiredPoints}\``).join('\n'))
          .setFooter({ text: "Use these IDs with modify/remove commands" });
          
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
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

  private async handleShopModalSubmit(interaction: ModalSubmitInteraction) {
    if (interaction.customId !== 'shop_balance_modal') return;

    const pending = this.pendingShopPurchases.get(interaction.user.id);
    if (!pending) {
      await interaction.reply({ content: '❌ No pending purchase found. Please start over with `/shop buy`.', flags: MessageFlags.Ephemeral });
      return;
    }
    this.pendingShopPurchases.delete(interaction.user.id);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const balanceRaw = interaction.fields.getTextInputValue('buyer_balance');
    const buyerBalance = parseInt(balanceRaw.replace(/[^0-9]/g, ''), 10);
    if (isNaN(buyerBalance) || buyerBalance < 0) {
      await interaction.editReply({ content: '❌ Invalid balance — please enter a number.' });
      return;
    }

    const { originalInteraction, buyerId, buyerUsername, selectedIds, totalMsg, totalVc, paymentType, aboveRoleId, expiresAt } = pending;
    const guild = originalInteraction.guild!;
    const guildId = originalInteraction.guildId!;

    let createdRoleId: string | undefined;
    if (selectedIds.includes('custom_role')) {
      try {
        const aboveRoleSettingId = aboveRoleId ?? await storage.getSetting(SETTINGS_KEYS.SHOP_ABOVE_ROLE_ID);
        const aboveRole = aboveRoleSettingId ? guild.roles.cache.get(aboveRoleSettingId) : undefined;
        const newRole = await guild.roles.create({
          name: `${buyerUsername} - shop`,
          color: 0x808080,
          position: aboveRole ? aboveRole.position + 1 : undefined,
          reason: `/shop buy by ${interaction.user.username}`,
        });
        createdRoleId = newRole.id;
        const buyerMember = await guild.members.fetch(buyerId).catch(() => null);
        if (buyerMember) await buyerMember.roles.add(newRole).catch(() => {});
      } catch (roleErr) {
        console.error('Failed to create shop role:', roleErr);
      }
    }

    const tx = await storage.createShopTransaction({
      guildId,
      buyerDiscordId: buyerId,
      buyerUsername,
      items: selectedIds,
      totalMsgCost: totalMsg,
      totalVcHoursCost: totalVc,
      paymentType,
      buyerBalance,
      expiresAt,
      roleId: createdRoleId ?? null,
    });

    if (createdRoleId) {
      await storage.createShopRole({
        transactionId: tx.id,
        guildId,
        roleId: createdRoleId,
        buyerDiscordId: buyerId,
        expiresAt,
        expired: false,
      });
    }

    const shopChannelId = await storage.getSetting(SETTINGS_KEYS.SHOP_CHANNEL_ID);
    const shopChannel = shopChannelId
      ? (guild.channels.cache.get(shopChannelId) as TextChannel | undefined)
      : (originalInteraction.channel as TextChannel);

    const itemNameList = selectedIds.map(id => SHOP_ITEMS.find(i => i.id === id)!.label).join(', ');
    const costPaid = paymentType === 'msg'
      ? `**${totalMsg.toLocaleString()} messages** (balance: ${buyerBalance.toLocaleString()})`
      : `**${totalVc}h of VC** (balance: ${buyerBalance}h)`;

    const receiptEmbed = new EmbedBuilder()
      .setTitle('🧾 Shop Receipt')
      .setDescription(
        `<@${buyerId}> bought **${itemNameList}**\n` +
        `Paid with: ${costPaid}` +
        (createdRoleId ? `\n\n🎨 Role created: <@&${createdRoleId}>` : '')
      )
      .addFields({ name: 'Expires', value: `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>`, inline: true })
      .setColor(0xd2a4bf)
      .setTimestamp();

    if (shopChannel) await shopChannel.send({ embeds: [receiptEmbed] }).catch(() => {});

    await originalInteraction.editReply({ content: `Done! Receipt sent${shopChannel ? ` to <#${shopChannel.id}>` : ''}.`, embeds: [], components: [] }).catch(() => {});
    await interaction.editReply({ content: 'Purchase recorded!' });
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
