import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    console.log('Starting skybox generation with prompt:', prompt);

    // Decide which single face holds the unique focal subject (e.g. moon/sun).
    // We pick 'front' as the hero face. All other faces MUST NOT contain the focal subject.
    const heroFace = 'front';

    const faces = [
      { name: 'top',    description: 'TOP face (zenith) of a seamless 360° skybox cubemap — looking straight up. Pure sky only. NO horizon, NO ground, NO mountains. Must blend seamlessly with all 4 side faces at every edge.' },
      { name: 'bottom', description: 'BOTTOM face (nadir) of a seamless 360° skybox cubemap — looking straight down. Simple uniform ground/dark color. NO horizon line, NO subject. Must blend seamlessly with all 4 side faces at every edge.' },
      { name: 'front',  description: 'FRONT face (hero view) of a seamless 360° skybox cubemap — eye-level horizon view. THIS is the only face that contains the main focal subject. Left and right edges must continue seamlessly into LEFT and RIGHT faces.' },
      { name: 'back',   description: 'BACK face of a seamless 360° skybox cubemap — eye-level horizon view, opposite of front. Background atmosphere only, NO focal subject (no moon, no sun, no unique landmark). Left/right edges blend into RIGHT and LEFT faces.' },
      { name: 'left',   description: 'LEFT face of a seamless 360° skybox cubemap — eye-level horizon view, 90° left of front. Background atmosphere only, NO focal subject. Right edge connects to FRONT, left edge connects to BACK.' },
      { name: 'right',  description: 'RIGHT face of a seamless 360° skybox cubemap — eye-level horizon view, 90° right of front. Background atmosphere only, NO focal subject. Left edge connects to FRONT, right edge connects to BACK.' }
    ];

    console.log('Starting parallel generation of all 6 faces...');

    // Generate all faces in parallel for much faster results
    const generateFace = async (face: { name: string; description: string }) => {
      const isHero = face.name === heroFace;
      const facePrompt = `Generate ONE square 1024x1024 image — the ${face.description}

USER ENVIRONMENT: ${prompt}

ABSOLUTE RULES (must follow exactly):
1. The image MUST FILL THE ENTIRE 1024x1024 FRAME edge-to-edge. NO white background, NO black bars, NO letterboxing, NO blank borders, NO center-only strip. Every pixel is part of the scene.
2. NO text, NO labels, NO captions, NO watermarks, NO grid lines, NO UI elements.
3. Unique focal subjects (moon, sun, single landmark) appear EXACTLY ONCE across the whole 360° skybox, only on the FRONT face. ${isHero ? 'THIS IS THE FRONT/HERO FACE: include the focal subject (e.g. the moon) exactly ONCE here. Do not duplicate it.' : 'THIS IS NOT the front face: DO NOT draw the focal subject. NO moon, NO sun, NO duplicate landmark on this face — only the surrounding sky/aurora/atmosphere consistent with the scene.'}
4. Edges must blend seamlessly with adjacent cube faces so the 6 images form one continuous 360° environment.
5. Photorealistic, high quality, fully painted from corner to corner of the square.`;
      
      console.log(`Generating ${face.name} face...`);

      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash-image-preview',
          messages: [
            {
              role: 'user',
              content: facePrompt
            }
          ],
          modalities: ['image', 'text']
        }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('RATE_LIMIT');
        }
        if (response.status === 402) {
          throw new Error('PAYMENT_REQUIRED');
        }
        const errorText = await response.text();
        console.error(`AI gateway error for ${face.name}:`, response.status, errorText);
        throw new Error(`Failed to generate ${face.name} image`);
      }

      const data = await response.json();
      const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      
      if (!imageUrl) {
        console.error(`No image URL in response for ${face.name}:`, data);
        throw new Error(`Failed to get image URL for ${face.name}`);
      }

      console.log(`Successfully generated ${face.name} face`);
      return imageUrl;
    };

    try {
      // Generate all 6 faces simultaneously
      const generatedImages = await Promise.all(faces.map(face => generateFace(face)));
      console.log('All faces generated successfully');

      return new Response(
        JSON.stringify({ images: generatedImages }),
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
