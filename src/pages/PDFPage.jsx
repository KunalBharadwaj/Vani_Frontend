import PDFMerged from '@/components/pdf/PDFMerged';
import { useState, useEffect } from 'react';

const PDFPage = () => {
  const [error, setError] = useState(null);

  useEffect(() => {
    console.log('PDFPage mounted - PDF Editor route active');
    // Set error handler for uncaught errors
    const handleError = (event) => {
      console.error('Uncaught error in PDFPage:', event.error);
      setError(event.error?.message || 'Unknown error occurred');
    };
    
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-red-100 border border-red-400 text-red-700 px-8 py-6 rounded-lg max-w-md">
          <h2 className="font-bold mb-2">PDF Viewer Error</h2>
          <p>{error}</p>
          <button
            onClick={() => {
              setError(null);
              window.location.reload();
            }}
            className="mt-4 px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
          >
            Reload Page
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen">
      <PDFMerged />
    </div>
  );
};

export default PDFPage;
