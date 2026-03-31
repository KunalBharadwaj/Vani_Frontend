// Offline gallery for saved drawings.
// Uses localStorage to persist a list of pages, each containing
// a thumbnail and the full canvas data URL.
import { useState, useEffect } from "react";
import { Trash2, Image, X, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

// Single localStorage key under which all saved drawings are stored.
const STORAGE_KEY = "chanakya-saved-pages";

// Read and parse all saved pages from localStorage.
export const getSavedPages = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    console.log("Getting saved pages:", saved ? JSON.parse(saved).length : 0, "items");
    return saved ? JSON.parse(saved) : [];
  } catch (error) {
    console.error("Error getting saved pages:", error);
    return [];
  }
};

// Add a new page at the beginning of the list and persist to localStorage.
export const savePage = (page) => {
  try {
    const pages = getSavedPages();
    pages.unshift(page);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pages));
    console.log("Saved page successfully. Total pages:", pages.length);
    return true;
  } catch (error) {
    console.error("Error saving page:", error);
    return false;
  }
};

// Remove a page by id and write the updated list back to localStorage.
export const deletePage = (id) => {
  const pages = getSavedPages().filter((p) => p.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pages));
};

export const SavedPagesGallery = ({ onLoad }) => {
  const [pages, setPages] = useState([]);
  const [open, setOpen] = useState(false);

  // Refresh pages when dialog opens
  useEffect(() => {
    if (open) {
      const savedPages = getSavedPages();
      console.log("Gallery opened, found pages:", savedPages.length);
      setPages(savedPages);
    }
  }, [open]);

  // Also listen for storage changes (for cross-tab sync)
  useEffect(() => {
    const handleStorageChange = () => {
      if (open) {
        setPages(getSavedPages());
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [open]);

  const handleDelete = (id, e) => {
    e.stopPropagation();
    deletePage(id);
    setPages(getSavedPages());
  };

  const handleLoad = (canvasData) => {
    onLoad(canvasData);
    setOpen(false);
  };

  const handleRefresh = () => {
    const savedPages = getSavedPages();
    console.log("Manual refresh, found pages:", savedPages.length);
    setPages(savedPages);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-toolbar-foreground hover:bg-toolbar-foreground/10"
        >
          <Image className="w-4 h-4 mr-1" />
          Gallery
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>Saved Drawings</DialogTitle>
            <Button variant="ghost" size="sm" onClick={handleRefresh} className="mr-6">
              <RefreshCw className="w-4 h-4 mr-1" />
              Refresh
            </Button>
          </div>
        </DialogHeader>
        <ScrollArea className="h-[400px] pr-4">
          {pages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[300px] text-muted-foreground">
              <Image className="w-12 h-12 mb-2 opacity-50" />
              <p>No saved drawings yet</p>
              <p className="text-sm">Save your work to see it here</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {pages.map((page) => (
                <div
                  key={page.id}
                  className="group relative cursor-pointer rounded-lg border border-border overflow-hidden hover:border-primary transition-colors"
                  onClick={() => handleLoad(page.canvasData)}
                >
                  <img
                    src={page.thumbnail}
                    alt={page.name}
                    className="w-full aspect-square object-cover bg-white"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                    <span className="text-white opacity-0 group-hover:opacity-100 text-sm font-medium">
                      Load
                    </span>
                  </div>
                  <button
                    onClick={(e) => handleDelete(page.id, e)}
                    className="absolute top-1 right-1 p-1 rounded bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1">
                    <p className="text-white text-xs truncate">{page.name}</p>
                    <p className="text-white/60 text-[10px]">
                      {new Date(page.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};