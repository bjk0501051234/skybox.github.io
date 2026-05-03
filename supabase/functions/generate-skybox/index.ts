import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const AI_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';

interface FacePlan {
  top: string;
  bottom: string;
  front: string;
  back: string;
  left: string;
  right: string;
  global_style: string;
  unique_subjects: string[]; // e.g. ["moon"]
  hero_face: 'front' | 'back' | 'left' | 'right';
}

async function planScene(prompt: string, apiKey: string): Promise<FacePlan> {
  const system = `You are a skybox director for a Roblox-style cubemap (6 faces: top, bottom, front, back, left, right). The 6 faces are viewed from INSIDE a cube to form a 360° environment.

Your job:
1. Read the user's environment description carefully (it may be in Korean).
2. Identify any UNIQUE focal subjects that should appear ONLY ONCE in the whole scene (moon, sun, single planet, single landmark). List them in unique_subjects.
3. Pick which face holds the main focal subject (usually 'front').
4. Write a detailed, concrete visual description for EACH of the 6 faces, in English, so an image model can generate them. Each face description must:
   - Describe what is visible in that direction (sky, horizon, atmosphere, color gradients, cloud shapes, aurora bands, stars, etc.).
   - Reference neighboring faces so edges blend (e.g. "the aurora ribbon continues from the right edge of the FRONT face").
   - Specify which side of the focal subject this face shows (e.g. "the moon sits in the upper-right of the FRONT face, so the LEFT face shows the open sky on the moon's left side").
   - For TOP: pure sky/zenith only — no horizon, no ground.
   - For BOTTOM: simple ground/dark surface — no horizon line.
   - NON-hero side faces (front/back/left/right that are not the hero) MUST NOT contain the focal subject (no second moon).
5. Write a short global_style string describing palette, mood, lighting, time of day, art style, atmosphere consistency.

Return ONLY valid JSON matching the tool schema.`;

  const resp = await fetch(AI_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `User environment description:\n"""\n${prompt}\n"""\n\nPlan the 6 skybox faces now.` },
      ],
      tools: [{
        type: 'function',
        function: {
          name: 'plan_skybox',
          description: 'Return the per-face plan for a 360° skybox.',
          parameters: {
            type: 'object',
            properties: {
              global_style: { type: 'string' },
              unique_subjects: { type: 'array', items: { type: 'string' } },
              hero_face: { type: 'string', enum: ['front', 'back', 'left', 'right'] },
              top: { type: 'string' },
              bottom: { type: 'string' },
              front: { type: 'string' },
              back: { type: 'string' },
              left: { type: 'string' },
              right: { type: 'string' },
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
    console.error('Planner error:', resp.status, t);
    if (resp.status === 429) throw new Error('RATE_LIMIT');
    if (resp.status === 402) throw new Error('PAYMENT_REQUIRED');
    throw new Error('Planner failed');
  }

  const data = await resp.json();
  const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) throw new Error('Planner returned no plan');
  return JSON.parse(args) as FacePlan;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { prompt } = await req.json();

    if (!prompt) {
      return new Response(
        JSON.stringify({ error: 'Prompt is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY is not configured');

    console.log('Starting skybox generation with prompt:', prompt);

    // STEP 1: Plan the scene with a reasoning model
    console.log('Planning scene...');
    const plan = await planScene(prompt, LOVABLE_API_KEY);
    console.log('Plan ready. Hero face:', plan.hero_face, 'Unique subjects:', plan.unique_subjects);

    const faceOrder: Array<keyof Pick<FacePlan, 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right'>> = [
      'top', 'bottom', 'front', 'back', 'left', 'right',
    ];

    const buildFacePrompt = (face: typeof faceOrder[number]): string => {
      const isHero = face === plan.hero_face;
      const isSide = face === 'front' || face === 'back' || face === 'left' || face === 'right';
      const subjectLine = plan.unique_subjects.length === 0
        ? 'No unique focal subjects in this scene.'
        : isHero
          ? `This face IS the hero face. Include each of these unique subjects EXACTLY ONCE here, nowhere else: ${plan.unique_subjects.join(', ')}.`
          : isSide
            ? `DO NOT draw any of these unique subjects on this face: ${plan.unique_subjects.join(', ')}. Show only the surrounding sky/atmosphere consistent with the scene.`
            : `Do not draw any of these unique subjects: ${plan.unique_subjects.join(', ')}.`;

      return `You are generating ONE square 1024x1024 image — face "${face.toUpperCase()}" of a seamless 360° skybox cubemap (Roblox-style), viewed from inside a cube.

GLOBAL STYLE (must be consistent across all 6 faces): ${plan.global_style}

THIS FACE'S CONTENT: ${plan[face]}

UNIQUE-SUBJECT RULE: ${subjectLine}

HARD RULES (must follow exactly):
- The image MUST FILL THE ENTIRE 1024x1024 FRAME corner-to-corner. NO white background, NO black bars, NO letterboxing, NO blank borders, NO center-only strip, NO frame, NO margins.
- NO text, NO labels, NO captions, NO watermarks, NO grid lines, NO arrows, NO UI.
- Edges must blend seamlessly with the adjacent cube faces so all 6 images form one continuous 360° environment with no visible seams.
- ${face === 'top' ? 'TOP face: pure sky/zenith only. No horizon, no ground, no mountains.' : ''}
- ${face === 'bottom' ? 'BOTTOM face: simple uniform ground or dark surface. No horizon line, no subject.' : ''}
- Photorealistic, ultra-high quality, cinematic lighting, sharp detail, fully painted from corner to corner.`;
    };

    const generateFace = async (face: typeof faceOrder[number]): Promise<string> => {
      const facePrompt = buildFacePrompt(face);
      console.log(`Generating ${face} face...`);

      const response = await fetch(AI_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash-image',
          messages: [{ role: 'user', content: facePrompt }],
          modalities: ['image', 'text'],
        }),
      });

      if (!response.ok) {
        if (response.status === 429) throw new Error('RATE_LIMIT');
        if (response.status === 402) throw new Error('PAYMENT_REQUIRED');
        const errorText = await response.text();
        console.error(`AI gateway error for ${face}:`, response.status, errorText);
        throw new Error(`Failed to generate ${face} image`);
      }

      const data = await response.json();
      const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      if (!imageUrl) {
        console.error(`No image URL for ${face}:`, JSON.stringify(data).slice(0, 500));
        throw new Error(`Failed to get image URL for ${face}`);
      }
      console.log(`Successfully generated ${face} face`);
      return imageUrl;
    };

    try {
      const generated = await Promise.all(faceOrder.map((f) => generateFace(f)));
      console.log('All faces generated successfully');
      return new Response(
        JSON.stringify({ images: generated }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'RATE_LIMIT') {
          return new Response(
            JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
            { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        if (error.message === 'PAYMENT_REQUIRED') {
          return new Response(
            JSON.stringify({ error: 'Payment required. Please add credits to your workspace.' }),
            { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
      throw error;
    }
  } catch (error) {
    console.error('Error in generate-skybox function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to generate skybox' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
