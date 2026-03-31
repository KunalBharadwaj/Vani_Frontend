import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { FileText, PaintBucket, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

const Navigation = () => {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const searchString = searchParams.toString() ? `?${searchParams.toString()}` : '';

  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    window.location.href = '/';
  };

  return (
    <nav className="fixed bottom-4 right-4 z-50 flex gap-2 bg-white/90 backdrop-blur-sm rounded-lg shadow-lg p-2">
      <Link to={`/${searchString}`}>
        <Button
          variant={location.pathname === '/' ? 'default' : 'outline'}
          size="sm"
          className="gap-2"
        >
          <PaintBucket className="h-4 w-4" />
          Paint
        </Button>
      </Link>
      <Link to={`/pdf${searchString}`}>
        <Button
          variant={location.pathname === '/pdf' ? 'default' : 'outline'}
          size="sm"
          className="gap-2"
        >
          <FileText className="h-4 w-4" />
          PDF Editor
        </Button>
      </Link>
      <div className="w-px h-8 bg-gray-200 mx-1 self-center" />
      <Button
        variant="ghost"
        size="sm"
        className="gap-2 text-red-500 hover:text-red-600 hover:bg-red-50"
        onClick={handleLogout}
      >
        <LogOut className="h-4 w-4" />
        Logout
      </Button>
    </nav>
  );
};

export default Navigation;
