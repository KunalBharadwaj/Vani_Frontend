import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PRESET_COLORS = [
  "#000000", "#FFFFFF", "#808080", "#C0C0C0",
  "#800000", "#FF0000", "#808000", "#FFFF00",
  "#008000", "#00FF00", "#008080", "#00FFFF",
  "#000080", "#0000FF", "#800080", "#FF00FF",
  "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4",
  "#FFEAA7", "#DDA0DD", "#98D8C8", "#F7DC6F",
];

export const ColorPalette = ({ activeColor, onColorChange }) => {
  return (
    <div className="flex items-center gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <button
            className="w-8 h-8 rounded border-2 border-toolbar-foreground/30 hover:border-toolbar-foreground/50 transition-colors"
            style={{ backgroundColor: activeColor }}
          />
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3" align="start">
          <div className="space-y-3">
            <div className="grid grid-cols-8 gap-1">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  className={cn(
                    "w-6 h-6 rounded border transition-transform hover:scale-110",
                    activeColor === color ? "border-primary border-2" : "border-border"
                  )}
                  style={{ backgroundColor: color }}
                  onClick={() => onColorChange(color)}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="custom-color" className="text-xs">Custom:</Label>
              <Input
                id="custom-color"
                type="color"
                value={activeColor}
                onChange={(e) => onColorChange(e.target.value)}
                className="w-12 h-8 p-0 border-0 cursor-pointer"
              />
              <Input
                type="text"
                value={activeColor}
                onChange={(e) => onColorChange(e.target.value)}
                className="w-20 h-8 text-xs uppercase"
                placeholder="#000000"
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>
      
      <div className="flex gap-0.5">
        {PRESET_COLORS.slice(0, 12).map((color) => (
          <button
            key={color}
            className={cn(
              "w-5 h-5 rounded-sm border transition-transform hover:scale-110",
              activeColor === color ? "border-toolbar-active border-2" : "border-toolbar-foreground/20"
            )}
            style={{ backgroundColor: color }}
            onClick={() => onColorChange(color)}
          />
        ))}
      </div>
    </div>
  );
};