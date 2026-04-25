// Drawing toolbar — tool selection, colors, brush size, and image import.
// Undo/Redo and Save/Download are handled by PaintCanvas directly.
import {
  Pencil, Eraser, Square, Circle, Minus,
  Trash2, PaintBucket, Palette, Upload, Highlighter, Check,
} from "lucide-react";
import { ToolButton } from "./ToolButton";
import { ColorPalette } from "./ColorPalette";
import { BrushSizeSlider } from "./BrushSizeSlider";
import { Separator } from "@/components/ui/separator";
import { SavedPagesGallery } from "./SavedPagesGallery";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRef } from "react";

const BG_COLORS = [
  "#FFFFFF", "#F8F9FA", "#E9ECEF", "#000000",
  "#FFF8E1", "#E3F2FD", "#E8F5E9", "#FCE4EC",
  "#F3E5F5", "#FFFDE7", "#E0F7FA", "#FBE9E7",
];

export const Toolbar = ({
  activeTool,
  onToolChange,
  activeColor,
  onColorChange,
  backgroundColor,
  onBackgroundColorChange,
  brushSize,
  onBrushSizeChange,
  onClear,
  onLoadPage,
  onImportImage,
  onPlaceImage,
  hasImportedImage,
  // kept for back-compat but not rendered here
  onUndo, onRedo, canUndo, canRedo,
  onSave, onDownload, onDownloadAllPages,
  onLoadBackupFile, backupFileRef,
  onAddPage, onSwitchPage, pages, currentPageId,
  isMaximized, onToggleMaximize, orientation, onToggleOrientation,
}) => {
  const fileInputRef = useRef(null);

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowed = ["image/jpeg", "image/png", "application/pdf"];
    if (!allowed.includes(file.type)) { alert("Please select JPG, PNG, or PDF"); return; }
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result;
      if (typeof result === "string") onImportImage(result);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex items-center gap-0.5 px-1 py-0.5">

      {/* Drawing tools */}
      <ToolButton icon={Pencil}      label="Pencil"      shortcut="P" isActive={activeTool === "pencil"}      onClick={() => onToolChange("pencil")} />
      <ToolButton icon={Highlighter} label="Highlighter" shortcut="H" isActive={activeTool === "highlighter"} onClick={() => onToolChange("highlighter")} />
      <ToolButton icon={Eraser}      label="Eraser"      shortcut="E" isActive={activeTool === "eraser"}      onClick={() => onToolChange("eraser")} />
      <ToolButton icon={PaintBucket} label="Fill"        shortcut="G" isActive={activeTool === "fill"}        onClick={() => onToolChange("fill")} />

      <Separator orientation="vertical" className="h-5 bg-toolbar-foreground/20 mx-1" />

      {/* Shapes */}
      <ToolButton icon={Square} label="Rectangle" shortcut="R" isActive={activeTool === "rectangle"} onClick={() => onToolChange("rectangle")} />
      <ToolButton icon={Circle} label="Circle"    shortcut="C" isActive={activeTool === "circle"}    onClick={() => onToolChange("circle")} />
      <ToolButton icon={Minus}  label="Line"      shortcut="L" isActive={activeTool === "line"}      onClick={() => onToolChange("line")} />

      <Separator orientation="vertical" className="h-5 bg-toolbar-foreground/20 mx-1" />

      {/* Brush size */}
      <BrushSizeSlider size={brushSize} onSizeChange={onBrushSizeChange} />

      <Separator orientation="vertical" className="h-5 bg-toolbar-foreground/20 mx-1" />

      {/* Stroke color */}
      <ColorPalette activeColor={activeColor} onColorChange={onColorChange} />

      <Separator orientation="vertical" className="h-5 bg-toolbar-foreground/20 mx-1" />

      {/* Background color */}
      <Popover>
        <PopoverTrigger asChild>
          <button
            className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-toolbar-hover transition-colors"
            title="Canvas Background Color"
          >
            <Palette size={14} className="text-toolbar-foreground/70" />
            <div className="w-4 h-4 rounded-sm border border-toolbar-foreground/30" style={{ backgroundColor }} />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3" align="start">
          <div className="space-y-2">
            <Label className="text-xs font-medium">Background</Label>
            <div className="grid grid-cols-4 gap-1">
              {BG_COLORS.map((color) => (
                <button
                  key={color}
                  className={`w-7 h-7 rounded-md border-2 transition-transform hover:scale-110 ${
                    backgroundColor === color ? "border-primary ring-1 ring-primary" : "border-border"
                  }`}
                  style={{ backgroundColor: color }}
                  onClick={() => onBackgroundColorChange(color)}
                />
              ))}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Label htmlFor="bg-color" className="text-xs">Custom:</Label>
              <Input id="bg-color" type="color" value={backgroundColor} onChange={(e) => onBackgroundColorChange(e.target.value)} className="w-10 h-7 p-0 border-0 cursor-pointer" />
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <Separator orientation="vertical" className="h-5 bg-toolbar-foreground/20 mx-1" />

      {/* Import image */}
      <ToolButton icon={Upload} label="Import Image" title="Import JPG, PNG, PDF" onClick={() => fileInputRef.current?.click()} />
      <input ref={fileInputRef} type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={handleFileSelect} className="hidden" />

      {/* Place image — only when one is being positioned */}
      {hasImportedImage && (
        <ToolButton icon={Check} label="Place Image" title="Finalize image position" onClick={onPlaceImage} />
      )}

      <Separator orientation="vertical" className="h-5 bg-toolbar-foreground/20 mx-1" />

      {/* Clear canvas */}
      <ToolButton icon={Trash2} label="Clear Canvas" onClick={onClear} />

      {/* Gallery / restore saved drawing */}
      <SavedPagesGallery onLoad={onLoadPage} />
    </div>
  );
};
