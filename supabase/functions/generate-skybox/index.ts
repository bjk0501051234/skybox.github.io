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
      { name: 'top', description: 'top face of 360° seamless skybox cubemap, looking straight up at the zenith sky, all edges must blend seamlessly with horizon faces' },
      { name: 'bottom', description: 'bottom face of 360° seamless skybox cubemap, looking straight down at the ground/nadir, all edges must connect perfectly with horizon faces' },
      { name: 'front', description: 'front face of 360° seamless skybox cubemap, forward horizon view at eye level, left and right edges must continue seamlessly to adjacent faces' },
      { name: 'back', description: 'back face of 360° seamless skybox cubemap, backward horizon view at eye level, left and right edges must continue seamlessly to adjacent faces, opposite view of front' },
      { name: 'left', description: 'left face of 360° seamless skybox cubemap, left side horizon view at eye level, edges must connect seamlessly to front and back faces' },
      { name: 'right', description: 'right face of 360° seamless skybox cubemap, right side horizon view at eye level, edges must connect seamlessly to front and back faces' }
    ];

    console.log('Starting parallel generation of all 6 faces...');

    // Generate all faces in parallel for much faster results
    const generateFace = async (face: { name: string; description: string }) => {
      const facePrompt = `Create a seamless 360° panoramic skybox cubemap texture: ${prompt}. This is the ${face.description}. CRITICAL: Edges must blend perfectly with adjacent cube faces to form a continuous 360° environment. Avoid any visible seams or discontinuities at edges. Ultra high quality, photorealistic, 1024x1024, seamless tileable texture for 3D environment mapping.`;
      
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
