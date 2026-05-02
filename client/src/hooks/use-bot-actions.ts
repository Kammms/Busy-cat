import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";

export function useBotActions() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const refreshCache = useMutation({
    mutationFn: async () => {
      const res = await fetch(api.bot.refreshCache.path, {
        method: api.bot.refreshCache.method,
      });
      if (!res.ok) throw new Error("Failed to refresh cache");
      return api.bot.refreshCache.responses[200].parse(await res.json());
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [api.moderators.list.path] });
      toast({ title: "Success", description: data.message });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: "Error", description: error.message });
    },
  });

  const generateLeaderboard = useMutation({
    mutationFn: async () => {
      const res = await fetch(api.bot.generateLeaderboard.path, {
        method: api.bot.generateLeaderboard.method,
      });
      if (!res.ok) throw new Error("Failed to generate leaderboard");
      return api.bot.generateLeaderboard.responses[200].parse(await res.json());
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [api.moderators.list.path] });
      toast({ title: "Success", description: data.message });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: "Error", description: error.message });
    },
  });

  return { refreshCache, generateLeaderboard };
}
