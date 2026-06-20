import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOVABLE_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

type Provider = 'lovable' | 'gemini' | 'huggingface';
interface ProviderKey { provider: Provider; api_key: string; priority: number; }

type FaceName = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';
interface Sticker { face: FaceName; description: string; }
interface SkyPlan {
  panorama_prompt: string;
  stickers: Sticker[];
}

// =========== PLANNING ===========
// Split user's request into:
//   1. pure sky panorama prompt (NO objects, NO clouds, NO moon, NO stars — just sky colors / aurora / gradient / atmosphere)
//   2. list of objects to "sticker" onto specific faces afterwards (moon, clouds, stars, planets, etc.)

const PLAN_SYSTEM = `
You are a skybox director for a 360° Roblox-style cubemap.

Your job is to convert the user request into:
A) panorama_prompt: PURE SKY description only
B) stickers: optional objects placed on faces

-------------------------
CRITICAL RULES (VERY IMPORTANT)
-------------------------

1. DO NOT REINTERPRET USER COLOR OR MOOD
- If user says "red sky", "dark sky", "sunset", you MUST preserve that intent directly.
- Do NOT convert colors into purple, blue, aurora, or "fantasy safe tones".

2. AVOID STYLE COLLAPSE
- Do NOT default to aurora, dreamy, or purple skies unless explicitly requested.
- Each request must produce a visually different sky.

3. PANORAMA MUST BE DIVERSE
- Allowed sky types include:
  - realistic sunset / sunrise
  - stormy dark sky
  - blood red sky
  - clear blue sky
  - volcanic / ash sky
  - cloudy dramatic sky
  - night sky (stars allowed ONLY if user implies night)

4. NO DEFAULT FANTASY BIAS
- Do NOT assume "beautiful = purple aurora".
- Match realism or mood strictly from user input.

-------------------------
OUTPUT RULES
-------------------------

A) panorama_prompt:
- Describe ONLY sky atmosphere
- Must preserve user's color, mood, and intensity
- Avoid adding extra aesthetic filters not requested

B) stickers:
- Place objects only if explicitly mentioned
- If not specified, keep empty array []
- Do not duplicate singular objects across faces

-------------------------
IMPORTANT BEHAVIOR
-------------------------

- You are NOT an art enhancer.
- You are a faithful translator of user intent into sky description.
- Diversity between outputs is REQUIRED.
`;
function planTool() {
  return {
    type: 'function',
    function: {
      name: 'plan_sky',
      parameters: {
        type: 'object',
        properties: {
          panorama_prompt: { type: 'string', description: 'Pure sky panorama description (no objects).' },
          stickers: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                face: { type: 'string', enum: ['top', 'bottom', 'front', 'back', 'left', 'right'] },
                description: { type: 'string', description: 'What to add to this face. e.g. "a single large full moon with realistic crater detail, soft glow blending into the surrounding sky"' },
              },
              required: ['face', 'description'],
              additionalProperties: false,
            },
          },
        },
        required: ['panorama_prompt', 'stickers'],
        additionalProperties: false,
      },
    },
  };
}

async function planWithLovable(prompt: string, key: string): Promise<SkyPlan> {
  const resp = await fetch(LOVABLE_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'google/gemini-2.5-pro',
      messages: [
        { role: 'system', content: PLAN_SYSTEM },
        { role: 'user', content: `User description:\n"""\n${prompt}\n"""\nPlan now.` },
      ],
      tools: [planTool()],
      tool_choice: { type: 'function', function: { name: 'plan_sky' } },
    }),
  });
  if (!resp.ok) {
    if (resp.status === 429 || resp.status === 402) throw new Error('QUOTA');
    throw new Error(`Lovable plan: ${resp.status} ${(await resp.text()).slice(0,200)}`);
  }
  const data = await resp.json();
  const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) throw new Error('Lovable plan: no args');
  return JSON.parse(args);
}

async function planWithGemini(prompt: string, key: string): Promise<SkyPlan> {
  const url = `${GEMINI_BASE}/gemini-2.0-flash:generateContent?key=${key}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: PLAN_SYSTEM + '\nReturn JSON: {panorama_prompt:string, stickers:[{face,description}]}' }] },
      contents: [{ role: 'user', parts: [{ text: `User description:\n"""\n${prompt}\n"""\nReturn JSON only.` }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });
  if (!resp.ok) {
    if (resp.status === 429 || resp.status === 403) throw new Error('QUOTA');
    throw new Error(`Gemini plan: ${resp.status} ${(await resp.text()).slice(0,200)}`);
  }
  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini plan: no text');
  return JSON.parse(text);
}

// =========== PANORAMA (pure sky, no objects) ===========

function buildPanoramaPrompt(p: string): string {
  return `Generate ONE seamless 360° equirectangular panoramic sky texture (2:1 aspect, very wide horizontal). Pure sky atmosphere ONLY.

SKY: ${p}

HARD RULES:

- ABSOLUTELY NO discrete objects: no moon, no sun, no stars, no planets, no buildings, no creatures.
- NO horizon line, no terrain, no ground elements.

- SKY MUST BE DIVERSE AND MATCH USER INTENT EXACTLY:
  - red sky if requested (do NOT shift to purple/blue)
  - blue sky if requested (pure blue, no purple tint)
  - dark storm sky if requested
  - sunset must remain warm orange/red tones (not purple)

- DO NOT ADD DEFAULT FANTASY STYLES:
  - no aurora unless explicitly requested
  - no dreamy look unless explicitly requested
  - no cinematic glow unless explicitly requested

- ALLOWED ONLY WHEN USER REQUESTS OR IMPLICITLY FITS CONTEXT:
  - natural atmospheric scattering
  - realistic cloudless sky gradients

- COLOR ACCURACY IS PRIORITY:
  - preserve hue direction (red stays red, blue stays blue)
  - avoid hue shifting between unrelated colors

- MUST TILE/WRAP seamlessly left↔right (equirectangular projection)

- NO text, watermark, borders, frames, letterboxing

- Output must be physically plausible sky rendering, not stylized fantasy default

async function panoramaWithLovable(prompt: string, key: string): Promise<string> {
  const resp = await fetch(LOVABLE_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash-image',
      messages: [{ role: 'user', content: buildPanoramaPrompt(prompt) }],
      modalities: ['image', 'text'],
    }),
  });
  if (!resp.ok) {
    if (resp.status === 429 || resp.status === 402) throw new Error('QUOTA');
    throw new Error(`Lovable pano: ${resp.status}`);
  }
  const data = await resp.json();
  const url = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) throw new Error('Lovable pano: no url');
  return url;
}

async function panoramaWithGemini(prompt: string, key: string): Promise<string> {
  const url = `${GEMINI_BASE}/gemini-2.0-flash-exp-image-generation:generateContent?key=${key}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: buildPanoramaPrompt(prompt) }] }],
      generationConfig: { responseModalities: ['Image', 'Text'] },
    }),
  });
  if (!resp.ok) {
    if (resp.status === 429 || resp.status === 403) throw new Error('QUOTA');
    throw new Error(`Gemini pano: ${resp.status}`);
  }
  const data = await resp.json();
  for (const p of data.candidates?.[0]?.content?.parts ?? []) {
    if (p.inlineData?.data) return `data:${p.inlineData.mimeType || 'image/png'};base64,${p.inlineData.data}`;
  }
  throw new Error('Gemini pano: no image');
}

// =========== STICKER (edit single face image, add one object naturally) ===========

function buildStickerPrompt(desc: string, face: FaceName): string {
  return `You are given a square sky image (one face of a 360° skybox cubemap, face = ${face.toUpperCase()}, viewed from inside the cube).

TASK: Add the following onto this sky, fully integrated and natural:
${desc}

STRICT RULES:
- KEEP the existing sky background EXACTLY as is. Do not change its color, gradient, or atmosphere.
- The new object must look like it BELONGS in the sky — soft edges, realistic atmospheric glow, light scattering, and CAST appropriate light/shadow/haze on the surrounding sky around it. Not a flat sticker.
- Do not add anything not asked for. No text, watermarks, borders, frames, letterboxing.
- Return the modified full-frame image, same square dimensions, filled corner to corner.`;
}

async function stickerWithLovable(desc: string, face: FaceName, faceImage: string, key: string): Promise<string> {
  const resp = await fetch(LOVABLE_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash-image',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: buildStickerPrompt(desc, face) },
          { type: 'image_url', image_url: { url: faceImage } },
        ],
      }],
      modalities: ['image', 'text'],
    }),
  });
  if (!resp.ok) {
    if (resp.status === 429 || resp.status === 402) throw new Error('QUOTA');
    throw new Error(`Lovable sticker: ${resp.status}`);
  }
  const data = await resp.json();
  const url = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) throw new Error('Lovable sticker: no url');
  return url;
}

async function stickerWithGemini(desc: string, face: FaceName, faceImage: string, key: string): Promise<string> {
  // faceImage is data:image/png;base64,XXXX — strip prefix
  const m = faceImage.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
  if (!m) throw new Error('Gemini sticker: bad image input');
  const url = `${GEMINI_BASE}/gemini-2.0-flash-exp-image-generation:generateContent?key=${key}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { text: buildStickerPrompt(desc, face) },
          { inlineData: { mimeType: m[1], data: m[2] } },
        ],
      }],
      generationConfig: { responseModalities: ['Image', 'Text'] },
    }),
  });
  if (!resp.ok) {
    if (resp.status === 429 || resp.status === 403) throw new Error('QUOTA');
    throw new Error(`Gemini sticker: ${resp.status}`);
  }
  const data = await resp.json();
  for (const p of data.candidates?.[0]?.content?.parts ?? []) {
    if (p.inlineData?.data) return `data:${p.inlineData.mimeType || 'image/png'};base64,${p.inlineData.data}`;
  }
  throw new Error('Gemini sticker: no image');
}

// =========== PROVIDER FALLBACK ===========

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
      errors.push(`${p.provider}:${msg}`);
    }
  }
  throw new Error(`All providers failed for ${label}. ${errors.join(' | ')}`);
}

async function loadProviders(req: Request): Promise<ProviderKey[]> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
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
    }
  }
  const hasLovable = userKeys.some(k => k.provider === 'lovable');
  const providers = [...userKeys];
  if (!hasLovable && LOVABLE_API_KEY) {
    providers.push({ provider: 'lovable', api_key: LOVABLE_API_KEY, priority: 999 });
  }
  providers.sort((a, b) => a.priority - b.priority);
  return providers;
}

// =========== HANDLER ===========

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const action = body.action ?? 'plan-and-panorama';
    const selected = (body.provider ?? 'auto') as 'auto' | Provider;
    let providers = await loadProviders(req);
    if (selected !== 'auto') {
      providers = providers.filter((p) => p.provider === selected);
      if (providers.length === 0) {
        return new Response(JSON.stringify({ error: `선택한 제공자(${selected})의 키가 없습니다. /settings에서 등록하세요.` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }
    if (providers.length === 0) {
      return new Response(JSON.stringify({ error: 'AI 키가 설정되지 않았습니다. /settings에서 키를 등록하세요.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'plan-and-panorama') {
      const { prompt } = body;
      if (!prompt) throw new Error('prompt required');
      const plan = await tryProviders(providers, {
        lovable: (k) => planWithLovable(prompt, k),
        gemini: (k) => planWithGemini(prompt, k),
      }, 'plan');
      console.log('Plan:', JSON.stringify(plan));
      const panorama = await tryProviders(providers, {
        lovable: (k) => panoramaWithLovable(plan.panorama_prompt, k),
        gemini: (k) => panoramaWithGemini(plan.panorama_prompt, k),
      }, 'panorama');
      return new Response(JSON.stringify({ panorama, stickers: plan.stickers }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'sticker') {
      const { faceImage, face, description } = body;
      if (!faceImage || !face || !description) throw new Error('faceImage, face, description required');
      const image = await tryProviders(providers, {
        lovable: (k) => stickerWithLovable(description, face, faceImage, k),
        gemini: (k) => stickerWithGemini(description, face, faceImage, k),
      }, `sticker-${face}`);
      return new Response(JSON.stringify({ image }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (error) {
    console.error('generate-skybox error:', error);
    const msg = error instanceof Error ? error.message : 'Failed';
    return new Response(JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
