// Toolbar shown above the canvas.
// Provides tool selection (pencil, shapes, fill), brush size, colors,
// and actions like undo/redo, clear, save to gallery, download, and open gallery.
import { 
  Pencil, 
  Eraser, 
  Square, 
  Circle, 
  Minus, 
  Undo2, 
  Redo2, 
  Trash2, 
  Save,
  PaintBucket,
  Palette,
  Download,
  DownloadCloud,
  Upload,
  Highlighter,
  Maximize,
  Minimize,
  Plus,
  Check,
  FolderOpen,
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
  "#FFFFFF", "#F5F5F5", "#E0E0E0", "#000000",
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
  onUndo,
  onRedo,
  onClear,
  onSave,
  onLoadPage,
  canUndo,
  canRedo,
  onDownload,
  onDownloadAllPages,
  onLoadBackupFile,
  onImportImage,
  onAddPage,
  onSwitchPage,
  pages = [],
  currentPageId,
  isMaximized,
  onToggleMaximize,
  orientation,
  onToggleOrientation,
  onPlaceImage,
  hasImportedImage,
  backupFileRef,
}) => {
  const fileInputRef = useRef(null);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
    if (!allowedTypes.includes(file.type)) {
      alert("Please select a valid image (JPG, PNG) or PDF file");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result;
      if (typeof result === 'string') {
        onImportImage(result);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex items-center gap-1 px-3 py-2 bg-toolbar rounded-lg overflow-x-auto">
      {/* Selection & Drawing Tools */}
      <div className="flex items-center gap-0.5">
        <ToolButton
          icon={Pencil}
          label="Pencil"
          shortcut="P"
          isActive={activeTool === "pencil"}
          onClick={() => onToolChange("pencil")}
        />
        <ToolButton
          icon={Eraser}
          label="Eraser"
          shortcut="E"
          isActive={activeTool === "eraser"}
          onClick={() => onToolChange("eraser")}
        />
        <ToolButton
          icon={PaintBucket}
          label="Fill"
          shortcut="G"
          isActive={activeTool === "fill"}
          onClick={() => onToolChange("fill")}
        />
        <ToolButton
          icon={Highlighter}
          label="Highlighter"
          shortcut="H"
          isActive={activeTool === "highlighter"}
          onClick={() => onToolChange("highlighter")}
        />
      </div>

      <Separator orientation="vertical" className="h-6 bg-toolbar-foreground/20" />

      {/* Shape Tools */}
      <div className="flex items-center gap-0.5">
        <ToolButton
          icon={Square}
          label="Rectangle"
          shortcut="R"
          isActive={activeTool === "rectangle"}
          onClick={() => onToolChange("rectangle")}
        />
        <ToolButton
          icon={Circle}
          label="Circle"
          shortcut="C"
          isActive={activeTool === "circle"}
          onClick={() => onToolChange("circle")}
        />
        <ToolButton
          icon={Minus}
          label="Line"
          shortcut="L"
          isActive={activeTool === "line"}
          onClick={() => onToolChange("line")}
        />
      </div>

      <Separator orientation="vertical" className="h-6 bg-toolbar-foreground/20" />

      {/* Brush Size */}
      <BrushSizeSlider size={brushSize} onSizeChange={onBrushSizeChange} />

      <Separator orientation="vertical" className="h-6 bg-toolbar-foreground/20" />

      {/* Colors */}
      <ColorPalette activeColor={activeColor} onColorChange={onColorChange} />

      <Separator orientation="vertical" className="h-6 bg-toolbar-foreground/20" />

      {/* Background Color */}
      <Popover>
        <PopoverTrigger asChild>
          <button
            className="flex items-center gap-1 px-2 py-1 rounded hover:bg-toolbar-foreground/10 transition-colors"
            title="Background Color"
          >
            <Palette size={16} className="text-toolbar-foreground" />
            <div
              className="w-5 h-5 rounded border border-toolbar-foreground/30"
              style={{ backgroundColor: backgroundColor }}
            />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3" align="start">
          <div className="space-y-3">
            <Label className="text-xs font-medium">Background Color</Label>
            <div className="grid grid-cols-4 gap-1">
              {BG_COLORS.map((color) => (
                <button
                  key={color}
                  className={`w-8 h-8 rounded border-2 transition-transform hover:scale-110 ${
                    backgroundColor === color ? "border-primary" : "border-border"
                  }`}
                  style={{ backgroundColor: color }}
                  onClick={() => onBackgroundColorChange(color)}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="bg-color" className="text-xs">Custom:</Label>
              <Input
                id="bg-color"
                type="color"
                value={backgroundColor}
                onChange={(e) => onBackgroundColorChange(e.target.value)}
                className="w-12 h-8 p-0 border-0 cursor-pointer"
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <div className="flex-1" />

      {/* Import & Pages */}
      <div className="flex items-center gap-0.5">
        <ToolButton
          icon={Upload}
          label="Import Image"
          title="Import JPG, PNG, PDF"
          onClick={handleImportClick}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.pdf"
          onChange={handleFileSelect}
          className="hidden"
        />
        {hasImportedImage && (
          <ToolButton
            icon={Check}
            label="Place Image"
            title="Finalize image position"
            onClick={onPlaceImage}
          />
        )}
        <ToolButton
          icon={Plus}
          label="New Page"
          onClick={onAddPage}
        />
      </div>

      <Separator orientation="vertical" className="h-6 bg-toolbar-foreground/20" />

      {/* View Options */}
      <div className="flex items-center gap-0.5">
        <ToolButton
          icon={isMaximized ? Minimize : Maximize}
          label={isMaximized ? "Minimize" : "Maximize"}
          onClick={onToggleMaximize}
        />
        <ToolButton
          icon={Minus}
          label={`${orientation === "portrait" ? "Portrait" : "Landscape"}`}
          title="Toggle View Mode"
          onClick={onToggleOrientation}
        />
      </div>

      <Separator orientation="vertical" className="h-6 bg-toolbar-foreground/20" />

      {/* Actions */}
      <div className="flex items-center gap-0.5">
        <ToolButton
          icon={Undo2}
          label="Undo"
          shortcut="Ctrl+Z"
          onClick={onUndo}
        />
        <ToolButton
          icon={Redo2}
          label="Redo"
          shortcut="Ctrl+Y"
          onClick={onRedo}
        />
        <ToolButton
          icon={Trash2}
          label="Clear Canvas"
          onClick={onClear}
        />
        <ToolButton
          icon={Save}
          label="Save Drawing"
          shortcut="Ctrl+S"
          onClick={onSave}
        />
        <ToolButton
          icon={Download}
          label="Download to Downloads"
          onClick={onDownload}
        />
        <ToolButton
          icon={DownloadCloud}
          label="Download All Pages"
          onClick={onDownloadAllPages}
        />
      </div>

      <Separator orientation="vertical" className="h-6 bg-toolbar-foreground/20" />

      {/* Restore & Gallery */}
      <div className="flex items-center gap-0.5">
        <ToolButton
          icon={FolderOpen}
          label="Restore Backup"
          title="Load pages from JSON backup"
          onClick={() => backupFileRef?.current?.click()}
        />
        <input
          ref={backupFileRef}
          type="file"
          accept=".json"
          onChange={onLoadBackupFile}
          className="hidden"
        />
        <SavedPagesGallery onLoad={onLoadPage} />
      </div>
    </div>
  );
};
