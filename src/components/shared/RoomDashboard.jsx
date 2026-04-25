// Shared Room Dashboard modal - shows participants and allows owner assignment.
// Used by both Paint and PDF Editor.
import { Users, X } from 'lucide-react';

export const RoomDashboard = ({ show, onClose, roomState, isHost, onAssignOwner }) => {
  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 text-left">
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl max-w-md w-full overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b dark:border-zinc-800">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Users className="w-5 h-5"/> Room Dashboard
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-black/5 rounded text-toolbar-foreground/60 hover:text-red-500">
            <X className="w-5 h-5"/>
          </button>
        </div>
        <div className="p-4 max-h-[60vh] overflow-y-auto space-y-2">
          {roomState?.users?.map(u => (
            <div key={u.id} className="flex items-center justify-between p-3 border dark:border-zinc-800 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg text-sm transition-colors">
              <div className="flex items-center gap-3">
                <img src={u.picture || 'https://www.gravatar.com/avatar/?d=mp'} className="w-8 h-8 rounded-full shadow-sm" alt="" />
                <div>
                  <span className="block font-medium truncate max-w-[150px]" title={u.name}>{u.name}</span>
                  <div className="flex gap-1 mt-0.5">
                    {roomState?.hostId === u.id && <span className="text-[10px] bg-yellow-500/20 text-yellow-600 px-1.5 py-0.5 rounded border border-yellow-500/30">Host</span>}
                    {roomState?.ownerId === u.id && <span className="text-[10px] bg-green-500/20 text-green-600 px-1.5 py-0.5 rounded border border-green-500/30">Owner</span>}
                    {roomState?.hostId !== u.id && roomState?.ownerId !== u.id && <span className="text-[10px] bg-gray-500/20 text-gray-500 px-1.5 py-0.5 rounded border border-gray-500/30">Participant</span>}
                  </div>
                </div>
              </div>
              {isHost && roomState?.ownerId !== u.id && (
                <button onClick={() => onAssignOwner(u.id)} className="text-xs bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded transition-colors shadow-sm">Make Owner</button>
              )}
            </div>
          ))}
          {(!roomState?.users || roomState.users.length === 0) && (
            <div className="text-center text-sm text-toolbar-foreground/40 py-8">No members connected</div>
          )}
        </div>
      </div>
    </div>
  );
};
