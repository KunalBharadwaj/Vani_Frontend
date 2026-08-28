import { X, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";

// Shared "Magic Search" result modal used by both the Notes canvas and the PDF
// editor. Renders the AI explanation (markdown) for a selected region.
export function MagicSearchModal({ open, response, onClose }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 text-left">
      <div className="glass-panel-strong animate-glass-in rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-toolbar-foreground/10">
          <h2 className="text-lg font-semibold flex items-center gap-2 text-primary">
            <Sparkles className="w-5 h-5" /> Magic Search Results
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-toolbar-hover text-toolbar-foreground/60 hover:text-red-400 transition-all duration-150 hover:scale-105"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto prose prose-sm dark:prose-invert max-w-none text-toolbar-foreground">
          {response ? <ReactMarkdown>{response}</ReactMarkdown> : <p>No response generated.</p>}
        </div>
        <div className="p-4 border-t border-toolbar-foreground/10 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
