// ECD Intelligence Platform — Login Page
// Simple phone + password auth, designed for AWW accessibility

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { api, setTokens } from "@/lib/apiClient";
import { Phone, Lock, Eye, EyeOff, LogIn } from "lucide-react";

export default function Login() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone || !password) return;

    setLoading(true);
    try {
      const result = await api.login(phone, password);
      setTokens(result.access_token, result.refresh_token);
      localStorage.setItem("ecd_user", JSON.stringify(result.user));
      navigate("/");
    } catch {
      toast({
        title: "Login Failed",
        description: "Invalid phone number or password",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Demo mode: skip login for development
  const handleDemoMode = () => {
    localStorage.setItem("ecd_demo_mode", "true");
    localStorage.setItem("ecd_user", JSON.stringify({
      id: "demo_user",
      name: "Demo User",
      role: "State Admin",
      phone: "0000000000",
    }));
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mx-auto">
            <span className="text-2xl font-bold text-white">ECD</span>
          </div>
          <CardTitle className="text-xl">ECD Intelligence Platform</CardTitle>
          <p className="text-sm text-muted-foreground">
            AI-Powered Early Childhood Development System
          </p>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <Phone className="w-4 h-4" /> Phone Number
              </label>
              <input
                type="tel"
                inputMode="numeric"
                placeholder="Enter 10-digit phone number"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                className="w-full h-14 px-4 text-lg border-2 rounded-lg focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
                autoComplete="tel"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <Lock className="w-4 h-4" /> Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-14 px-4 pr-12 text-lg border-2 rounded-lg focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-muted-foreground"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <Button type="submit" className="w-full h-14 text-lg" disabled={loading}>
              <LogIn className="w-5 h-5 mr-2" />
              {loading ? "Signing in..." : "Sign In"}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-xs text-muted-foreground mb-2">For development only</p>
            <Button variant="outline" size="sm" onClick={handleDemoMode}>
              Enter Demo Mode
            </Button>
          </div>

          <p className="text-[10px] text-center text-muted-foreground mt-6">
            Government of Andhra Pradesh &middot; ICDS Program
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
