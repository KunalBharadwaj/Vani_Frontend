import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export const ToolButton = ({ icon: Icon, label, isActive, onClick, shortcut }) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={cn(
            "tool-button",
            isActive && "tool-button-active"
          )}
        >
          <Icon className="w-5 h-5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="flex items-center gap-2">
        <span>{label}</span>
        {shortcut && <kbd className="px-1.5 py-0.5 text-xs bg-muted rounded">{shortcut}</kbd>}
      </TooltipContent>
    </Tooltip>
  );
};