import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useSettings, useUpdateSetting } from "@/hooks/use-settings";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Loader2, Save, Settings2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SETTINGS_KEYS } from "@shared/schema";

const formSchema = z.object({
  moderatorRoleId: z.string().min(1, "Role ID is required"),
  trackedChannelId: z.string().min(1, "Channel ID is required"),
  pointsPer1000Msg: z.string().refine((val) => !isNaN(parseInt(val)), "Must be a number"),
  pointsPerInvite: z.string().refine((val) => !isNaN(parseInt(val)), "Must be a number"),
});

export default function SettingsPage() {
  const { data: settings, isLoading } = useSettings();
  const updateSetting = useUpdateSetting();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      moderatorRoleId: "",
      trackedChannelId: "",
      pointsPer1000Msg: "15",
      pointsPerInvite: "1",
    },
  });

  // Populate form when data loads
  useEffect(() => {
    if (settings) {
      const getVal = (key: string) => settings.find(s => s.key === key)?.value || "";
      
      form.reset({
        moderatorRoleId: getVal(SETTINGS_KEYS.MODERATOR_ROLE_ID),
        trackedChannelId: getVal(SETTINGS_KEYS.TRACKED_CHANNEL_ID),
        pointsPer1000Msg: getVal(SETTINGS_KEYS.POINTS_PER_1000_MSG) || "15",
        pointsPerInvite: getVal(SETTINGS_KEYS.POINTS_PER_INVITE) || "1",
      });
    }
  }, [settings, form]);

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      // Update all settings in parallel
      await Promise.all([
        updateSetting.mutateAsync({ key: SETTINGS_KEYS.MODERATOR_ROLE_ID, value: values.moderatorRoleId }),
        updateSetting.mutateAsync({ key: SETTINGS_KEYS.TRACKED_CHANNEL_ID, value: values.trackedChannelId }),
        updateSetting.mutateAsync({ key: SETTINGS_KEYS.POINTS_PER_1000_MSG, value: values.pointsPer1000Msg }),
        updateSetting.mutateAsync({ key: SETTINGS_KEYS.POINTS_PER_INVITE, value: values.pointsPerInvite }),
      ]);
      
      toast({
        title: "Settings Saved",
        description: "Bot configuration has been updated successfully.",
      });
    } catch (error) {
      // Error handling is done in mutation onError
    }
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="w-12 h-12 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-8">
        <div>
          <h2 className="text-3xl font-display font-bold text-white tracking-tight">Bot Settings</h2>
          <p className="text-muted-foreground">Configure IDs and point values for the tracking system.</p>
        </div>

        <Card className="glass-card border-white/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings2 className="w-5 h-5 text-primary" />
              Configuration
            </CardTitle>
            <CardDescription>
              These settings control how the bot tracks points and identifies moderators.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                
                <div className="space-y-4">
                  <h4 className="text-sm font-medium text-white/80">Discord Identifiers</h4>
                  <FormField
                    control={form.control}
                    name="moderatorRoleId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Moderator Role ID</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. 123456789012345678" {...field} className="bg-secondary/50 border-white/10 font-mono" />
                        </FormControl>
                        <FormDescription>
                          Users with this role will be tracked in the dashboard.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="trackedChannelId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tracked Channel ID</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. 123456789012345678" {...field} className="bg-secondary/50 border-white/10 font-mono" />
                        </FormControl>
                        <FormDescription>
                          Only messages in this channel count towards points.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <Separator className="bg-white/5" />

                <div className="space-y-4">
                  <h4 className="text-sm font-medium text-white/80">Point System</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="pointsPer1000Msg"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Points per 1000 Messages</FormLabel>
                          <FormControl>
                            <Input type="number" {...field} className="bg-secondary/50 border-white/10" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="pointsPerInvite"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Points per Invite</FormLabel>
                          <FormControl>
                            <Input type="number" {...field} className="bg-secondary/50 border-white/10" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <div className="pt-4 flex justify-end">
                  <Button 
                    type="submit" 
                    disabled={updateSetting.isPending}
                    className="bg-primary hover:bg-primary/90 text-white min-w-[140px]"
                  >
                    {updateSetting.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        Save Changes
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
