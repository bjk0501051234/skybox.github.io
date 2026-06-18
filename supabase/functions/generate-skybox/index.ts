import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOVABLE_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const HF_FLUX = 'https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell';

type Provider = 'lovable' | 'gemini' | 'huggingface';
interface ProviderKey { provider: Provider; api_key: string; priority: number; }

interface FacePlan {
  top: string; bottom: string; front: string; back: string; left: string; right: string;
  global_style: string; unique_subjects: string[];
  hero_face: 'front' | 'back' | 'left' | 'right';
}

const PLAN_SYSTEM = `You are an expert skybox director for a Roblox-style cubemap (6 faces: top, bottom, front, back, left, right) viewed from INSIDE the cube. The user description may be Korean and may include explicit placement (e.g. "달은 왼쪽면에"), quantity constraints ("달은 하나만"), mood/time/weather words, and unfamiliar references (places, art styles, anime, games, astronomical phenomena) — use your training knowledge to recall what they actually look like and render them faithfully.

Rules:
- Honor explicit face assignments. If user says moon goes LEFT, hero_face = "left".
- hero_face defaults to "front" if unspecified.
- Each face description must be concrete English: sky gradient with color words, horizon, cloud shapes, aurora ribbons (with direction), star fields, atmospheric haze, ground texture. Reference neighboring faces so edges blend seamlessly.
- TOP: pure sky/zenith only, no horizon/ground/mountains, still continues aurora/star pattern.
- BOTTOM: simple uniform ground/dark surface, no horizon line, no subject.
- Side faces that are NOT the hero face MUST NOT contain unique subjects (no second moon/sun).
- Hero face holds each unique subject EXACTLY ONCE.
Return ONLY valid JSON via the tool.`;

function buildFacePrompt(face: keyof FacePlan, plan: FacePlan): string {
  const isHero = face === plan.hero_face;
  const isSide = face === 'front' || face === 'back' || face === 'left' || face === 'right';
  const subjectLine = plan.unique_subjects.length === 0
    ? 'No unique focal subjects.'
    : isHero
      ? `This face IS the hero. Include each unique subject EXACTLY ONCE here, nowhere else: ${plan.unique_subjects.join(', ')}.`
      : isSide
        ? `DO NOT draw any unique subjects on this face: ${plan.unique_subjects.join(', ')}. Only surrounding sky/atmosphere.`
        : `Do not draw any unique subjects: ${plan.unique_subjects.join(', ')}.`;
  return `Generate ONE square 1024x1024 image — face "${(face as string).toUpperCase()}" of a seamless 360° skybox cubemap (Roblox-style), viewed from inside a cube.

GLOBAL STYLE (consistent across all 6 faces): ${plan.global_style}

THIS FACE'S CONTENT: ${plan[face as keyof FacePlan]}

UNIQUE-SUBJECT RULE: ${subjectLine}

HARD RULES:
- MUST FILL ENTIRE 1024x1024 FRAME corner-to-corner. NO white background, NO black bars, NO letterboxing, NO blank borders, NO center strip, NO frame, NO margins.
- NO text, labels, captions, watermarks, grid lines, arrows, UI.
- Edges must blend seamlessly with adjacent faces for continuous 360° environment.
${face === 'top' ? '- TOP: pure sky/zenith only. No horizon, ground, or mountains.\n' : ''}${face === 'bottom' ? '- BOTTOM: simple uniform ground/dark surface, no horizon line or subject.\n' : ''}- Photorealistic, ultra-high quality, cinematic lighting, sharp detail, fully painted corner to corner.`;
}

// ============ PROVIDERS ============

async function planWithLovable(prompt: string, key: string): Promise<FacePlan> {
  const resp = await fetch(LOVABLE_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'google/gemini-2.5-pro',
      messages: [
        { role: 'system', content: PLAN_SYSTEM },
        { role: 'user', content: `User description:\n"""\n${prompt}\n"""\nPlan all 6 faces now.` },
      ],
      tools: [{
        type: 'function',
        function: {
          name: 'plan_skybox',
          parameters: {
            type: 'object',
            properties: {
              global_style: { type: 'string' },
              unique_subjects: { type: 'array', items: { type: 'string' } },
              hero_face: { type: 'string', enum: ['front', 'back', 'left', 'right'] },
              top: { type: 'string' }, bottom: { type: 'string' },
              front: { type: 'string' }, back: { type: 'string' },
              left: { type: 'string' }, right: { type: 'string' },
            },
            required: ['global_style', 'unique_subjects', 'hero_face', 'top', 'bottom', 'front', 'back', 'left', 'right'],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: 'function', function: { name: 'plan_skybox' } },
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    if (resp.status === 429 || resp.status === 402) throw new Error('QUOTA');
    throw new Error(`Lovable plan: ${resp.status} ${t.slice(0, 200)}`);
  }
  const data = await resp.json();
  const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) throw new Error('Lovable plan: no args');
  return JSON.parse(args);
}

async function planWithGemini(prompt: string, key: string): Promise<FacePlan> {
  const url = `${GEMINI_BASE}/gemini-2.0-flash:generateContent?key=${key}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: PLAN_SYSTEM + '\nReturn JSON matching: {global_style, unique_subjects[], hero_face, top, bottom, front, back, left, right}' }] },
      contents: [{ role: 'user', parts: [{ text: `User description:\n"""\n${prompt}\n"""\nPlan all 6 faces now. Return JSON only.` }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    if (resp.status === 429 || resp.status === 403) throw new Error('QUOTA');
    throw new Error(`Gemini plan: ${resp.status} ${t.slice(0, 200)}`);
  }
  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini plan: no text');
  return JSON.parse(text);
}

// Image generation
async function imageWithLovable(facePrompt: string, key: string): Promise<string> {
  const resp = await fetch(LOVABLE_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash-image',
      messages: [{ role: 'user', content: facePrompt }],
      modalities: ['image', 'text'],
    }),
  });
  if (!resp.ok) {
    if (resp.status === 429 || resp.status === 402) throw new Error('QUOTA');
    throw new Error(`Lovable img: ${resp.status}`);
  }
  const data = await resp.json();
  const url = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) throw new Error('Lovable img: no url');
  return url;
}

async function imageWithGemini(facePrompt: string, key: string): Promise<string> {
  const url = `${GEMINI_BASE}/gemini-2.0-flash-exp-image-generation:generateContent?key=${key}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: facePrompt }] }],
      generationConfig: { responseModalities: ['Image', 'Text'] },
    }),
  });
  if (!resp.ok) {
    if (resp.status === 429 || resp.status === 403) throw new Error('QUOTA');
    throw new Error(`Gemini img: ${resp.status}`);
  }
  const data = await resp.json();
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  for (const p of parts) {
    if (p.inlineData?.data) {
      return `data:${p.inlineData.mimeType || 'image/png'};base64,${p.inlineData.data}`;
    }
  }
  throw new Error('Gemini img: no inlineData');
}

async function imageWithHuggingFace(facePrompt: string, key: string): Promise<string> {
  const resp = await fetch(HF_FLUX, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'Accept': 'image/png' },
    body: JSON.stringify({
      inputs: facePrompt,
      parameters: { width: 1024, height: 1024, num_inference_steps: 4 },
    }),
  });
  if (!resp.ok) {
    if (resp.status === 429 || resp.status === 503) throw new Error('QUOTA');
    const t = await resp.text();
    throw new Error(`HF img: ${resp.status} ${t.slice(0, 150)}`);
  }
  const buf = await resp.arrayBuffer();
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  return `data:image/png;base64,${b64}`;
}

// ============ ORCHESTRATION ============

async function tryProviders<T>(
  providers: ProviderKey[],
  fns: Partial<Record<Provider, (key: string) => Promise<T>>>,
  label: string,
): Promise<T> {
  const errors: string[] = [];
  for (const p of providers) {
    const fn = fns[p.provider];
    if (!fn) continue;
    try {
      console.log(`[${label}] trying ${p.provider}`);
      return await fn(p.api_key);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[${label}] ${p.provider} failed: ${msg}`);
      errors.push(`${p.provider}: ${msg}`);
      // continue to next provider on any error (especially QUOTA)
    }
  }
  throw new Error(`All providers failed for ${label}. ${errors.join(' | ')}`);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { prompt } = await req.json();
    if (!prompt) {
      return new Response(JSON.stringify({ error: 'Prompt is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Load user's saved keys (if authenticated)
    let userKeys: ProviderKey[] = [];
    const authHeader = req.headers.get('Authorization');
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (user) {
        const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
        const { data } = await admin.from('user_api_keys')
          .select('provider, api_key, priority')
          .eq('user_id', user.id)
          .order('priority', { ascending: true });
        userKeys = (data ?? []) as ProviderKey[];
        console.log(`User ${user.id} keys:`, userKeys.map(k => k.provider));
      }
    }

    // Build effective provider list. If user provided no lovable override and workspace has key, append it last as default.
    const hasLovable = userKeys.some(k => k.provider === 'lovable');
    let providers = [...userKeys];
    if (!hasLovable && LOVABLE_API_KEY) {
      providers.push({ provider: 'lovable', api_key: LOVABLE_API_KEY, priority: 999 });
    }
    providers.sort((a, b) => a.priority - b.priority);

    if (providers.length === 0) {
      return new Response(JSON.stringify({ error: 'AI 키가 설정되지 않았습니다. /settings에서 키를 등록하세요.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log('Effective provider order:', providers.map(p => p.provider));

    // STEP 1: Plan (lovable or gemini; HF can't plan)
    const plan = await tryProviders(providers, {
      lovable: (k) => planWithLovable(prompt, k),
      gemini: (k) => planWithGemini(prompt, k),
    }, 'plan');
    console.log('Plan ready. hero=', plan.hero_face, 'subjects=', plan.unique_subjects);

    // STEP 2: Generate each face with provider fallback
    const faces: Array<keyof FacePlan> = ['top', 'bottom', 'front', 'back', 'left', 'right'];
    const images = await Promise.all(faces.map(async (face) => {
      const fp = buildFacePrompt(face, plan);
      return tryProviders(providers, {
        lovable: (k) => imageWithLovable(fp, k),
        gemini: (k) => imageWithGemini(fp, k),
        huggingface: (k) => imageWithHuggingFace(fp, k),
      }, `img-${face}`);
    }));

    return new Response(JSON.stringify({ images }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('generate-skybox error:', error);
    const msg = error instanceof Error ? error.message : 'Failed to generate skybox';
    return new Response(JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
