// Compact navigation pill — icons only to avoid covering canvas controls.
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { FileText, PaintBucket, LogOut, Sun, Moon, Copy, Check } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { useState } from 'react';

const Navigation = () => {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { theme, toggleTheme } = useTheme();
  const [copied, setCopied] = useState(false);
  const searchString = searchParams.toString() ? `?${searchParams.toString()}` : '';
  const roomId = searchParams.get('room');

  const copyRoomUrl = () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    window.location.href = '/';
  };

  const isPaint = location.pathname === '/';
  const isPdf = location.pathname === '/pdf';

  const iconBtn = 'w-8 h-8 flex items-center justify-center rounded-lg text-toolbar-foreground hover:bg-toolbar-hover transition-colors';
  const activeIconBtn = 'w-8 h-8 flex items-center justify-center rounded-lg bg-toolbar-active text-accent-foreground transition-colors';

  return (
    /* Positioned bottom-right, compact icon cluster */
    <nav
      className="fixed bottom-3 right-3 z-50 flex items-center gap-0.5 bg-toolbar border border-toolbar-foreground/10 rounded-xl shadow-lg p-1"
      title="Navigation"
    >
      {/* Paint */}
      <Link to={`/${searchString}`}>
        <button className={isPaint ? activeIconBtn : iconBtn} title="Paint">
          <PaintBucket className="h-3.5 w-3.5" />
        </button>
      </Link>

      {/* PDF */}
      <Link to={`/pdf${searchString}`}>
        <button className={isPdf ? activeIconBtn : iconBtn} title="PDF Editor">
          <FileText className="h-3.5 w-3.5" />
        </button>
      </Link>

      <div className="w-px h-5 bg-toolbar-foreground/15 mx-0.5" />

      {/* Room copy */}
      {roomId && (
        <button
          onClick={copyRoomUrl}
          className={`${iconBtn} ${copied ? 'text-green-500' : ''}`}
          title={copied ? 'Copied!' : `Copy room link (#${roomId})`}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      )}

      {/* Theme */}
      <button
        onClick={toggleTheme}
        className={iconBtn}
        title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
      >
        {theme === 'dark'
          ? <Sun className="h-3.5 w-3.5 text-yellow-400" />
          : <Moon className="h-3.5 w-3.5 text-indigo-400" />}
      </button>

      <div className="w-px h-5 bg-toolbar-foreground/15 mx-0.5" />

      {/* Logout */}
      <button
        onClick={handleLogout}
        className={`${iconBtn} hover:text-red-400`}
        title="Logout"
      >
        <LogOut className="h-3.5 w-3.5" />
      </button>
    </nav>
  );
};

export default Navigation;
