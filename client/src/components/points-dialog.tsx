import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PlusCircle, Loader2 } from "lucide-react";
import { useUpdateManualPoints } from "@/hooks/use-moderators";
import { useToast } from "@/hooks/use-toast";

interface PointsDialogProps {
  moderatorId: number;
  username: string;
}

export function PointsDialog({ moderatorId, username }: PointsDialogProps) {
  const [open, setOpen] = useState(false);
  const [points, setPoints] = useState("");
  const [reason, setReason] = useState("");
  
  const mutation = useUpdateManualPoints();
  const { toast } = useToast();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const pointsNum = parseInt(points);
    if (isNaN(pointsNum)) {
      toast({ variant: "destructive", title: "Invalid input", description: "Points must be a number" });
      return;
    }

    mutation.mutate(
      { id: moderatorId, data: { points: pointsNum, reason } },
      {
        onSuccess: () => {
          setOpen(false);
          setPoints("");
          setReason("");
        }
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 border-primary/20 hover:bg-primary/10 text-primary hover:text-primary">
          <PlusCircle className="w-3.5 h-3.5 mr-1.5" />
          Add Points
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md bg-card border-border shadow-2xl">
        <DialogHeader>
          <DialogTitle>Add Manual Points</DialogTitle>
          <DialogDescription>
            Adjust points for <span className="text-primary font-medium">@{username}</span> manually.
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label htmlFor="points">Points Amount</Label>
            <Input 
              id="points" 
              type="number" 
              placeholder="e.g. 50 or -20" 
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              className="bg-secondary/50 border-white/10 focus:ring-primary/50"
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="reason">Reason (Optional)</Label>
            <Input 
              id="reason" 
              placeholder="e.g. Bonus for event hosting" 
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="bg-secondary/50 border-white/10 focus:ring-primary/50"
            />
          </div>
          
          <div className="flex justify-end pt-2">
            <Button 
              type="submit" 
              disabled={mutation.isPending}
              className="bg-primary hover:bg-primary/90 text-white"
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Updating...
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
