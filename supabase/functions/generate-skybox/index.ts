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

CRITICAL LAYOUT REQUIREMENTS:
- Generate ONE SINGLE IMAGE in cross/cruciform layout
- Image must be 2048x1536 pixels (aspect ratio 4:3)
- Layout arranged as a cross shape:
      [  TOP   ]
[LEFT][FRONT][RIGHT][BACK]
      [BOTTOM ]

Each face is 512x512 pixels within the layout.

SEAMLESS INTEGRATION RULES:
- This is ONE continuous 360° environment, NOT six separate images
- Top face: Looking straight up at the zenith/sky
- Bottom face: Looking straight down at the ground/nadir
- Front/Back/Left/Right faces: Horizon views at eye level that connect seamlessly in a circle
- All edges MUST align perfectly when folded into a cube
- NO duplicate elements (like two moons or two suns)
- Consistent lighting and atmosphere across all faces
- Think of this as unfolding a paper cube - each face connects naturally

STYLE: Ultra high quality, photorealistic, seamless 360° panoramic environment, perfectly tileable cubemap texture for 3D environment mapping.`;

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
