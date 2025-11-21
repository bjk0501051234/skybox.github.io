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

    const faces = [
      { name: 'top', description: 'top view looking up at the sky' },
      { name: 'bottom', description: 'bottom view looking down at the ground' },
      { name: 'front', description: 'front view, straight ahead horizon' },
      { name: 'back', description: 'back view, opposite horizon' },
      { name: 'left', description: 'left side view' },
      { name: 'right', description: 'right side view' }
    ];

    const generatedImages: string[] = [];

    for (const face of faces) {
      const facePrompt = `${prompt}, ${face.description}, seamless skybox texture, high quality, photorealistic, 1024x1024`;
      
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
        console.error(`AI gateway error for ${face.name}:`, response.status, errorText);
        throw new Error(`Failed to generate ${face.name} image`);
      }

      const data = await response.json();
      const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      
      if (!imageUrl) {
        console.error(`No image URL in response for ${face.name}:`, data);
        throw new Error(`Failed to get image URL for ${face.name}`);
      }

      generatedImages.push(imageUrl);
      console.log(`Successfully generated ${face.name} face`);
    }

    console.log('All faces generated successfully');

    return new Response(
      JSON.stringify({ images: generatedImages }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in generate-skybox function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to generate skybox' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
