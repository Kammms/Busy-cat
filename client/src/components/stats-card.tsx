import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface StatsCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  trend?: string;
  className?: string;
}

export function StatsCard({ label, value, icon: Icon, trend, className }: StatsCardProps) {
  return (
    <div className={cn(
      "glass-card rounded-2xl p-6 relative overflow-hidden group hover:-translate-y-1 transition-transform duration-300", 
      className
    )}>
      {/* Background decoration */}
      <div className="absolute -right-4 -top-4 w-24 h-24 bg-primary/10 rounded-full blur-2xl group-hover:bg-primary/20 transition-colors" />
      
      <div className="relative z-10">
        <div className="flex justify-between items-start mb-4">
          <div className="p-3 rounded-xl bg-secondary/50 text-primary border border-white/5">
            <Icon className="w-5 h-5" />
          </div>
          {trend && (
            <span className="text-xs font-medium px-2 py-1 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
              {trend}
            </span>
          )}
        </div>
        
        <div className="space-y-1">
          <h3 className="text-3xl font-display font-bold text-foreground tracking-tight">{value}</h3>
          <p className="text-sm text-muted-foreground font-medium">{label}</p>
        </div>
      </div>
    </div>
  );
}
