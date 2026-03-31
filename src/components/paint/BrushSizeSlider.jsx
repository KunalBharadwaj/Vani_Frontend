import { Slider } from "@/components/ui/slider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export const BrushSizeSlider = ({ size, onSizeChange }) => {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-2 px-2 py-1 rounded hover:bg-toolbar-hover transition-colors">
          <div 
            className="rounded-full bg-toolbar-foreground"
            style={{ 
              width: Math.min(size, 20), 
              height: Math.min(size, 20),
              minWidth: 4,
              minHeight: 4
            }}
          />
          <span className="text-xs text-toolbar-foreground font-medium">{size}px</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-3" align="start">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Brush Size</span>
            <span className="text-sm text-muted-foreground">{size}px</span>
          </div>
          <Slider
            value={[size]}
            onValueChange={([value]) => onSizeChange(value)}
            min={1}
            max={100}
            step={1}
            className="w-full"
          />
          <div className="flex justify-between">
            {[2, 5, 10, 20, 50].map((preset) => (
              <button
                key={preset}
                onClick={() => onSizeChange(preset)}
                className="px-2 py-1 text-xs rounded bg-muted hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                {preset}
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};