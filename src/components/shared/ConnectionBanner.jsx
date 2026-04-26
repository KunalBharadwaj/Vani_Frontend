import { WifiOff, Loader2 } from "lucide-react";

export const ConnectionBanner = ({ status }) => {
  if (status === "connected") return null;

  return (
    <div className="fixed top-0 left-0 w-full z-[100] flex justify-center p-2 pointer-events-none">
      <div className="bg-red-500/90 text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2 backdrop-blur-sm pointer-events-auto">
        {status === "reconnecting" ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm font-medium">Reconnecting...</span>
          </>
        ) : (
          <>
            <WifiOff className="w-4 h-4" />
            <span className="text-sm font-medium">Offline - Changes will not be saved</span>
          </>
        )}
      </div>
    </div>
  );
};
