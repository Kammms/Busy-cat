import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import type { Moderator, UpdateManualPointsRequest } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

export function useModerators() {
  return useQuery({
    queryKey: [api.moderators.list.path],
    queryFn: async () => {
      const res = await fetch(api.moderators.list.path);
      if (!res.ok) throw new Error("Failed to fetch moderators");
      return api.moderators.list.responses[200].parse(await res.json());
    },
  });
}

export function useUpdateManualPoints() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: UpdateManualPointsRequest }) => {
      const url = buildUrl(api.moderators.updateManualPoints.path, { id });
      const validated = api.moderators.updateManualPoints.input.parse(data);
      
      const res = await fetch(url, {
        method: api.moderators.updateManualPoints.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to update points");
      }
      return api.moderators.updateManualPoints.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.moderators.list.path] });
      toast({ title: "Points updated", description: "Manual points have been added successfully." });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: "Error", description: error.message });
    },
  });
}

export function useToggleIgnore() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.moderators.toggleIgnore.path, { id });
      const res = await fetch(url, {
        method: api.moderators.toggleIgnore.method,
      });

      if (!res.ok) throw new Error("Failed to toggle status");
      return api.moderators.toggleIgnore.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.moderators.list.path] });
      toast({ title: "Status updated", description: "Moderator status has been toggled." });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: "Error", description: error.message });
    },
  });
}
