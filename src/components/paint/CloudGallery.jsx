import { useState, useEffect } from "react";
import { listFiles, deleteFile, downloadFile } from "@/services/storageService";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Trash2, Download, RefreshCw } from "lucide-react";

export const CloudGallery = ({ onLoadDrawing }) => {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadFiles = async () => {
    setLoading(true);
    const result = await listFiles();
    
    if (result.success) {
      setFiles(result.files);
      toast.success(`Loaded ${result.files.length} saved drawings`);
    } else {
      toast.error("Failed to load drawings");
    }
    setLoading(false);
  };

  useEffect(() => {
    loadFiles();
  }, []);

  const handleDelete = async (fileName) => {
    if (!confirm(`Delete ${fileName}?`)) return;

    const result = await deleteFile(fileName);
    
    if (result.success) {
      toast.success("File deleted");
      loadFiles();
    } else {
      toast.error("Failed to delete file");
    }
  };

  const handleDownload = async (file) => {
    const result = await downloadFile(file.name);
    
    if (result.success) {
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("File downloaded");
    } else {
      toast.error("Failed to download file");
    }
  };

  const handleLoad = (file) => {
    if (onLoadDrawing) {
      onLoadDrawing(file.url);
      toast.success("Drawing loaded");
    }
  };

  return (
    <div className="p-4 bg-white rounded-lg border">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Saved Drawings</h3>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={loadFiles}
          disabled={loading}
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <ScrollArea className="h-[400px]">
        {files.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            No saved drawings
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {files.map((file) => (
              <div 
                key={file.id}
                className="border rounded-lg overflow-hidden hover:shadow-lg transition-shadow"
              >
                <img
                  src={file.url}
                  alt={file.name}
                  className="w-full h-32 object-cover cursor-pointer"
                  onClick={() => handleLoad(file)}
                />
                <div className="p-2 bg-gray-50">
                  <p className="text-xs font-medium truncate mb-2">{file.name}</p>
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 h-7 text-xs"
                      onClick={() => handleDownload(file)}
                    >
                      <Download className="w-3 h-3 mr-1" />
                      Download
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => handleDelete(file.name)}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
};
