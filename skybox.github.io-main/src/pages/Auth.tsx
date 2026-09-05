import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";

export default function Auth() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const nav = useNavigate();
  const { user } = useAuth();

  useEffect(() => { if (user) nav("/", { replace: true }); }, [user, nav]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast({ title: "가입 완료", description: "자동으로 로그인됩니다." });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      nav("/", { replace: true });
    } catch (err) {
      toast({ title: "오류", description: err instanceof Error ? err.message : "실패", variant: "destructive" });
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="w-full max-w-md gradient-card p-8 rounded-xl border border-border/50 shadow-elevation space-y-6">
        <h1 className="text-2xl font-bold text-center">{mode === "login" ? "로그인" : "회원가입"}</h1>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label>이메일</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>비밀번호</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
          </div>
          <Button type="submit" disabled={busy} className="w-full gradient-primary">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "login" ? "로그인" : "가입하기"}
          </Button>
        </form>
        <button type="button" onClick={() => setMode(mode === "login" ? "signup" : "login")} className="w-full text-sm text-muted-foreground hover:text-foreground">
          {mode === "login" ? "계정이 없으신가요? 가입하기" : "이미 계정이 있나요? 로그인"}
        </button>
      </div>
    </div>
  );
}
