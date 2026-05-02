import { useMemo } from "react";
import { useModerators, useToggleIgnore } from "@/hooks/use-moderators";
import { useSettings } from "@/hooks/use-settings";
import { useBotActions } from "@/hooks/use-bot-actions";
import { Layout } from "@/components/layout";
import { StatsCard } from "@/components/stats-card";
import { PointsDialog } from "@/components/points-dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { 
  Users, 
  MessageSquare, 
  Trophy, 
  RefreshCw, 
  BarChart2, 
  Loader2,
  MoreHorizontal,
  ShieldAlert,
  ShieldCheck,
  Crown
} from "lucide-react";
import { SETTINGS_KEYS } from "@shared/schema";

export default function Dashboard() {
  const { data: moderators, isLoading: isLoadingMods, error: modsError } = useModerators();
  const { data: settings, isLoading: isLoadingSettings } = useSettings();
  const { refreshCache, generateLeaderboard } = useBotActions();
  const toggleIgnore = useToggleIgnore();

  // Get config values
  const pointsPer1000Msg = useMemo(() => {
    const val = settings?.find(s => s.key === SETTINGS_KEYS.POINTS_PER_1000_MSG)?.value;
    return val ? parseInt(val) : 15;
  }, [settings]);

  const pointsPerInvite = useMemo(() => {
    const val = settings?.find(s => s.key === SETTINGS_KEYS.POINTS_PER_INVITE)?.value;
    return val ? parseInt(val) : 1;
  }, [settings]);

  // Calculate stats
  const enrichedModerators = useMemo(() => {
    if (!moderators) return [];
    return moderators.map(mod => {
      const messagePoints = Math.floor(mod.messageCount / 1000) * pointsPer1000Msg;
      const invitePoints = mod.inviteCount * pointsPerInvite;
      const totalPoints = messagePoints + invitePoints + mod.leaderboardPoints + mod.manualPoints;
      return { ...mod, messagePoints, invitePoints, totalPoints };
    }).sort((a, b) => b.totalPoints - a.totalPoints); // Sort by total points
  }, [moderators, pointsPer1000Msg, pointsPerInvite]);

  const totalMessages = enrichedModerators.reduce((acc, curr) => acc + curr.messageCount, 0);
  const totalInvites = enrichedModerators.reduce((acc, curr) => acc + curr.inviteCount, 0);
  const activeMods = enrichedModerators.filter(m => !m.isIgnored).length;

  if (isLoadingMods || isLoadingSettings) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-[60vh]">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-12 h-12 animate-spin text-primary" />
            <p className="text-muted-foreground animate-pulse">Loading dashboard data...</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (modsError) {
    return (
      <Layout>
        <div className="bg-destructive/10 text-destructive p-4 rounded-xl border border-destructive/20 flex items-center gap-3">
          <ShieldAlert className="w-5 h-5" />
          <p>Failed to load data. Please try refreshing.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="flex flex-col gap-8">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-3xl font-display font-bold text-white tracking-tight">Overview</h2>
            <p className="text-muted-foreground">Track performance and manage points for your team.</p>
          </div>
          
          <div className="flex gap-3">
            <Button 
              variant="outline" 
              className="border-white/10 hover:bg-white/5"
              onClick={() => refreshCache.mutate()}
              disabled={refreshCache.isPending}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${refreshCache.isPending ? 'animate-spin' : ''}`} />
              Refresh Cache
            </Button>
            <Button 
              className="bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20"
              onClick={() => generateLeaderboard.mutate()}
              disabled={generateLeaderboard.isPending}
            >
              <BarChart2 className="w-4 h-4 mr-2" />
              {generateLeaderboard.isPending ? "Generating..." : "Generate Leaderboard"}
            </Button>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <StatsCard 
            label="Total Messages" 
            value={totalMessages.toLocaleString()} 
            icon={MessageSquare}
            className="border-blue-500/20"
          />
          <StatsCard 
            label="Total Invites" 
            value={totalInvites.toLocaleString()} 
            icon={Users}
            className="border-purple-500/20"
          />
          <StatsCard 
            label="Active Mods" 
            value={activeMods} 
            icon={ShieldCheck}
            className="border-green-500/20"
          />
        </div>

        {/* Leaderboard Table */}
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="p-6 border-b border-white/5">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Crown className="w-5 h-5 text-yellow-500" />
              Moderator Rankings
            </h3>
          </div>
          
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-secondary/30">
                <TableRow className="hover:bg-transparent border-white/5">
                  <TableHead className="w-[80px]">Rank</TableHead>
                  <TableHead>Moderator</TableHead>
                  <TableHead className="text-right">Messages</TableHead>
                  <TableHead className="text-right">Invites</TableHead>
                  <TableHead className="text-right">Msg Pts</TableHead>
                  <TableHead className="text-right">Inv Pts</TableHead>
                  <TableHead className="text-right">Ldr Pts</TableHead>
                  <TableHead className="text-right">Man Pts</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {enrichedModerators.map((mod, index) => (
                  <TableRow key={mod.id} className="border-white/5 hover:bg-white/5 transition-colors group">
                    <TableCell className="font-medium text-muted-foreground">
                      #{index + 1}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="w-8 h-8 border border-white/10">
                          <AvatarImage src={mod.avatar || undefined} />
                          <AvatarFallback className="bg-secondary text-xs">{mod.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col">
                          <span className="font-medium text-foreground group-hover:text-primary transition-colors">{mod.username}</span>
                          <span className="text-xs text-muted-foreground">{mod.discordId}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground font-mono">{mod.messageCount.toLocaleString()}</TableCell>
                    <TableCell className="text-right text-muted-foreground font-mono">{mod.inviteCount}</TableCell>
                    <TableCell className="text-right text-muted-foreground font-mono">{mod.messagePoints}</TableCell>
                    <TableCell className="text-right text-muted-foreground font-mono">{mod.invitePoints}</TableCell>
                    <TableCell className="text-right text-muted-foreground font-mono">{mod.leaderboardPoints}</TableCell>
                    <TableCell className="text-right text-muted-foreground font-mono">{mod.manualPoints}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 font-bold font-mono">
                        {mod.totalPoints}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={mod.isIgnored ? "destructive" : "default"} className={mod.isIgnored ? "" : "bg-green-500/10 text-green-500 hover:bg-green-500/20"}>
                        {mod.isIgnored ? "Ignored" : "Active"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <PointsDialog moderatorId={mod.id} username={mod.username} />
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => toggleIgnore.mutate(mod.id)}
                          disabled={toggleIgnore.isPending}
                          className={mod.isIgnored ? "text-green-500 hover:text-green-400 hover:bg-green-500/10" : "text-destructive hover:text-destructive hover:bg-destructive/10"}
                        >
                          {mod.isIgnored ? "Enable" : "Ignore"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                
                {enrichedModerators.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={11} className="h-32 text-center text-muted-foreground">
                      No moderators found. Make sure the bot is running and roles are configured correctly.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </Layout>
  );
}
