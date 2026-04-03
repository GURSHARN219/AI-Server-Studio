import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Eye, EyeOff, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import { authBackendResetPassword, authBackendSignIn, authBackendSignUp } from "@/lib/api";

interface AuthPageProps {
  onAuth: () => void;
  embeddedInAppShell?: boolean;
}

export default function AuthPage({ onAuth, embeddedInAppShell = false }: AuthPageProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (resetMode) {
        await authBackendResetPassword(email);
        toast({ title: "Check your email", description: "Password reset link sent." });
        setResetMode(false);
      } else if (isLogin) {
        await authBackendSignIn(email, password);
        onAuth();
      } else {
        await authBackendSignUp(email, password, displayName);
        toast({ title: "Account created", description: "Signed in successfully." });
        onAuth();
      }
    } catch (err: unknown) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Authentication failed", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`${embeddedInAppShell ? "h-full" : "min-h-screen"} flex items-center justify-center bg-background relative overflow-hidden`}>
      {/* Background grid effect */}
      <div className="absolute inset-0 opacity-[0.03]" style={{
        backgroundImage: `linear-gradient(hsl(var(--primary)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--primary)) 1px, transparent 1px)`,
        backgroundSize: '40px 40px'
      }} />
      
      {/* Glow effect */}
      <motion.div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full opacity-[0.06]"
        style={{ background: `radial-gradient(circle, hsl(var(--primary)), transparent 70%)` }}
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 0.06 }}
        transition={{ duration: 1.2, ease: "easeOut" }}
      />

      <motion.div
        className="w-full max-w-[380px] relative z-10 p-6"
        initial={{ opacity: 0, y: 30, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Header */}
        <motion.div
          className="text-center space-y-3 mb-8"
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15, ease: "easeOut" }}
        >
          <div className="w-16 h-16 rounded-xl bg-primary/5 border border-primary/20 flex items-center justify-center mx-auto backdrop-blur-sm p-1.5">
            <img
              src="/logo.png"
              alt="AI Server Studio"
              className="w-full h-full object-contain"
              draggable={false}
            />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground tracking-tight">AI Server Studio</h1>
            <p className="text-xs text-muted-foreground mt-1 font-mono">
              {resetMode ? "Reset your password" : isLogin ? "Sign in to continue" : "Create your account"}
            </p>
          </div>
        </motion.div>

        {/* Form card */}
        <motion.div
          className="rounded-xl border border-border bg-card/60 backdrop-blur-sm p-5 shadow-xl shadow-background/50"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <AnimatePresence mode="wait">
              {!isLogin && !resetMode && (
                <motion.div
                  key="display-name"
                  className="space-y-1.5"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  <Label className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Display Name</Label>
                  <Input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Your name"
                    className="h-9 text-xs bg-background/50 border-border/60 focus:border-primary/50 transition-colors"
                  />
                </motion.div>
              )}
            </AnimatePresence>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="h-9 text-xs bg-background/50 border-border/60 focus:border-primary/50 transition-colors"
              />
            </div>
            {!resetMode && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Password</Label>
                  {isLogin && (
                    <button
                      type="button"
                      onClick={() => setResetMode(true)}
                      className="text-[10px] text-primary/70 hover:text-primary transition-colors"
                    >
                      Forgot?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={6}
                    className="h-9 text-xs pr-9 bg-background/50 border-border/60 focus:border-primary/50 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            )}
            <Button type="submit" className="w-full h-9 text-xs font-medium gap-2 mt-2" disabled={loading}>
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <>
                  {resetMode ? "Send Reset Link" : isLogin ? "Sign In" : "Sign Up"}
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </Button>
          </form>
        </motion.div>

        {/* Footer links */}
        <motion.div
          className="text-center mt-5 space-y-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.4 }}
        >
          {!resetMode ? (
            <button
              onClick={() => setIsLogin(!isLogin)}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {isLogin ? (
                <>Don't have an account? <span className="text-primary font-medium">Sign up</span></>
              ) : (
                <>Already have an account? <span className="text-primary font-medium">Sign in</span></>
              )}
            </button>
          ) : (
            <button
              onClick={() => setResetMode(false)}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Back to sign in
            </button>
          )}
        </motion.div>

        {/* Version */}
        <p className="text-center text-[9px] text-muted-foreground/50 font-mono mt-6">v0.1.01</p>
      </motion.div>
    </div>
  );
}
