import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2, Save, Trash2 } from "lucide-react";

type Provider = "lovable" | "gemini" | "huggingface";

const META: Record<Provider, { label: string; help: string; link: string }> = {
  lovable: { label: "Lovable AI", help: "기본 제공. 별도 키 없이 사용 가능 (워크스페이스 크레딧)", link: "" },
  gemini: { label: "Google Gemini", help: "Google AI Studio에서 발급한 API 키를 입력하세요.", link: "https://aistudio.google.com/apikey" },
  huggingface: { label: "HuggingFace", help: "HuggingFace에서 발급한 Access Token을 입력하세요 (FLUX.1-schnell 무료 사용 가능).", link: "https://huggingface.co/settings/tokens" },
};

export default function Settings() {
  const { user, loading, signOut } = useAuth();
  const nav = useNavigate();
  const { toast } = useToast();
  const [keys, setKeys] = useState<Record<Provider, string>>({ lovable: "", gemini: "", huggingface: "" });
  const [priority, setPriority] = useState<Record<Provider, number>>({ lovable: 0, gemini: 1, huggingface: 2 });
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!loading && !user) nav("/auth"); }, [loading, user, nav]);

  useEffect(() => {
    if (!user) return;
    supabase.from("user_api_keys").select("*").eq("user_id", user.id).then(({ data }) => {
      if (!data) return;
      const k = { ...keys }; const p = { ...priority };
      for (const row of data) {
        k[row.provider as Provider] = row.api_key;
        p[row.provider as Provider] = row.priority;
      }
      setKeys(k); setPriority(p);
    });
  }, [user]);

  const save = async (provider: Provider) => {
    if (!user) return;
    setBusy(true);
    try {
      const value = keys[provider].trim();
      if (!value) {
        await supabase.from("user_api_keys").delete().eq("user_id", user.id).eq("provider", provider);
        toast({ title: "삭제됨", description: `${META[provider].label} 키 제거` });
      } else {
        const { error } = await supabase.from("user_api_keys").upsert({
          user_id: user.id, provider, api_key: value, priority: priority[provider],
        }, { onConflict: "user_id,provider" });
        if (error) throw error;
        toast({ title: "저장됨", description: `${META[provider].label} 키 저장` });
      }
    } catch (e) {
      toast({ title: "오류", description: e instanceof Error ? e.message : "실패", variant: "destructive" });
    } finally { setBusy(false); }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <Link to="/"><Button variant="ghost"><ArrowLeft className="h-4 w-4 mr-2" /> 돌아가기</Button></Link>
          <Button variant="outline" onClick={async () => { await signOut(); nav("/auth"); }}>로그아웃</Button>
        </div>
        <div>
          <h1 className="text-3xl font-bold">AI 키 설정</h1>
          <p className="text-muted-foreground mt-2">여러 제공자 키를 등록하면, 한도 초과 시 우선순위 순서로 자동 전환됩니다. (낮은 숫자 = 먼저 시도)</p>
        </div>

        {(Object.keys(META) as Provider[]).map((p) => (
          <div key={p} className="gradient-card p-6 rounded-xl border border-border/50 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">{META[p].label}</h2>
                <p className="text-sm text-muted-foreground">{META[p].help}</p>
                {META[p].link && (
                  <a href={META[p].link} target="_blank" rel="noreferrer" className="text-xs text-primary underline">
                    키 발급 페이지 열기
                  </a>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_120px_auto_auto] gap-3 items-end">
              <div>
                <Label>API 키 {p === "lovable" && "(비워두면 워크스페이스 기본 키 사용)"}</Label>
                <Input
                  type="password"
                  placeholder={p === "lovable" ? "(선택사항)" : "키 입력..."}
                  value={keys[p]}
                  onChange={(e) => setKeys({ ...keys, [p]: e.target.value })}
                />
              </div>
              <div>
                <Label>우선순위</Label>
                <Input
                  type="number"
                  value={priority[p]}
                  onChange={(e) => setPriority({ ...priority, [p]: parseInt(e.target.value) || 0 })}
                />
              </div>
              <Button onClick={() => save(p)} disabled={busy} className="gradient-primary">
                <Save className="h-4 w-4 mr-1" /> 저장
              </Button>
              {keys[p] && (
                <Button variant="destructive" onClick={() => { setKeys({ ...keys, [p]: "" }); save(p); }} disabled={busy}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
