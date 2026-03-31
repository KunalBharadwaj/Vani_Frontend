import { Button } from "@/components/ui/button";

export const Login = () => {
  const handleLogin = () => {
    window.location.href = "https://vani-backend-mjsl.onrender.com/auth/google";
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-900 text-white p-4">
      <div className="bg-slate-800 p-8 rounded-xl shadow-xl max-w-sm w-full text-center space-y-6">
        <div>
          <h1 className="text-2xl font-bold mb-2">Chanakya Paint</h1>
          <p className="text-slate-400">Collaborative educational drawing board.</p>
        </div>
        
        <Button onClick={handleLogin} className="w-full h-12 text-lg">
          Log In with Google
        </Button>

        <p className="text-xs text-slate-500 mt-4">
          To collaborate with others or save your work to the cloud, please sign in.
        </p>
      </div>
    </div>
  );
};
