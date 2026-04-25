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

  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    window.location.href = '/';
  };

  const copyRoomUrl = () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const activeBtn = 'bg-toolbar-active text-accent-foreground';
  const btn = 'flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-colors text-toolbar-foreground hover:bg-toolbar-hover';

  return (
    <nav className="fixed bottom-4 right-4 z-50 flex items-center gap-1 bg-toolbar border border-toolbar-foreground/10 rounded-2xl shadow-lg p-1.5">
      {/* Page switcher */}
      <Link to={`/${searchString}`}>
        <button className={`${btn} ${location.pathname === '/' ? activeBtn : ''}`}>
          <PaintBucket className="h-4 w-4" />
          Paint
        </button>
      </Link>
      <Link to={`/pdf${searchString}`}>
        <button className={`${btn} ${location.pathname === '/pdf' ? activeBtn : ''}`}>
          <FileText className="h-4 w-4" />
          PDF
        </button>
      </Link>

      <div className="w-px h-6 bg-toolbar-foreground/20 mx-0.5" />

      {/* Room ID copy */}
      {roomId && (
        <button
          onClick={copyRoomUrl}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-mono transition-colors ${
            copied
              ? 'bg-green-500/15 text-green-500'
              : 'text-toolbar-foreground hover:bg-toolbar-hover'
          }`}
          title="Copy room URL to share"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied!' : `#${roomId}`}
        </button>
      )}

      <div className="w-px h-6 bg-toolbar-foreground/20 mx-0.5" />

      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        className={`${btn} px-2.5`}
        title={theme === 'dark' ? 'Switch to Light' : 'Switch to Dark'}
      >
        {theme === 'dark'
          ? <Sun className="h-4 w-4 text-yellow-400" />
          : <Moon className="h-4 w-4 text-indigo-400" />}
      </button>

      <div className="w-px h-6 bg-toolbar-foreground/20 mx-0.5" />

      <button
        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-red-400 hover:bg-red-500/10 hover:text-red-500 transition-colors"
        onClick={handleLogout}
      >
        <LogOut className="h-4 w-4" />
        Logout
      </button>
    </nav>
  );
};

export default Navigation;
