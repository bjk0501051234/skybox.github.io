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

    console.log('Generating single cubemap cross layout image...');

    // Generate one large panoramic image in cubemap cross layout
    // Layout:
    //       [top]
    // [left][front][right][back]
    //       [bottom]
    const crossPrompt = `Create a seamless 360-degree panoramic skybox in CUBEMAP CROSS LAYOUT format for: ${prompt}.

LAYOUT (INTERNAL, DO NOT DRAW TEXT OR BORDERS):
- Imagine the image is arranged as a cubemap cross:
  * One square for TOP above
  * Four squares in a row for LEFT, FRONT, RIGHT, BACK
  * One square for BOTTOM below
- Each square/face is 512x512 pixels within a 2048x1536 image.

ABSOLUTE RULES:
- This is ONE continuous 360° environment, NOT six separate pictures.
- DO NOT draw any text, letters, labels, numbers, arrows, grids, borders, or UI.
- DO NOT write words like "TOP", "BOTTOM", "FRONT", etc. The image must look like pure sky/space/landscape.
- No duplicated suns or moons – keep lighting and main celestial bodies consistent.
- All neighboring edges must align perfectly when folded into a cube (like paper folding).

FACE ORIENTATION GUIDANCE (CONCEPTUAL ONLY):
- Top: Looking straight up at the sky/space.
- Bottom: Looking straight down at ground/nadir.
- Front/Back/Left/Right: Horizon views at eye level, smoothly wrapping 360°.

STYLE:
- Ultra high quality, photorealistic, seamless 360° panoramic environment.
- Perfectly tileable cubemap texture for 3D environment mapping.
- Follow the prompt theme strictly (e.g., one coherent galaxy/sky style).`;

    try {
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
              content: crossPrompt
            }
          ],
          modalities: ['image', 'text']
        }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          return new Response(
            JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
            { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        if (response.status === 402) {
          return new Response(
            JSON.stringify({ error: 'Payment required. Please add credits to your workspace.' }),
            { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        const errorText = await response.text();
        console.error('AI gateway error:', response.status, errorText);
        throw new Error('Failed to generate cubemap cross layout image');
      }

      const data = await response.json();
      const crossImageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      
      if (!crossImageUrl) {
        console.error('No image URL in response:', data);
        throw new Error('Failed to get cubemap cross layout image');
      }

      console.log('Successfully generated cubemap cross layout image');

      // Return the single cross layout image - frontend will slice it into 6 faces

      return new Response(
        JSON.stringify({ crossLayoutImage: crossImageUrl }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      console.error('Error generating cubemap:', error);
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
