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

    console.log('Starting sequential generation with image reference...');

    // Step 1: Generate TOP face first (the sky/zenith)
    const topPrompt = `Create the TOP face of a seamless 360° skybox cubemap for: ${prompt}.

VIEWING ANGLE: Looking straight UP at the sky/zenith from inside a cube.
CONTENT RULES:
- Pure sky view (NO mountains, NO ground, NO horizon line)
- If there are clouds, they should look natural from below
- Consistent lighting and atmosphere
- All 4 edges must blend seamlessly (this will connect to horizon faces)

STYLE: Ultra high quality, photorealistic, 1024x1024, seamless tileable texture.`;

    console.log('Generating TOP face...');
    const topResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-image-preview',
        messages: [{ role: 'user', content: topPrompt }],
        modalities: ['image', 'text']
      }),
    });

    if (!topResponse.ok) {
      if (topResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (topResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: 'Payment required. Please add credits to your workspace.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw new Error('Failed to generate TOP face');
    }

    const topData = await topResponse.json();
    const topImageUrl = topData.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!topImageUrl) throw new Error('Failed to get TOP image');
    console.log('Successfully generated TOP face');

    // Step 2: Generate FRONT, BACK, LEFT, RIGHT faces referencing the TOP
    const horizonFaces = [
      { name: 'front', description: 'FRONT face (forward view at eye level). Top edge connects to the sky above. Show horizon with ground/landscape.' },
      { name: 'back', description: 'BACK face (backward view at eye level, opposite of front). Top edge connects to the sky above. Show horizon with ground/landscape.' },
      { name: 'left', description: 'LEFT face (left side view at eye level). Top edge connects to the sky above. Show horizon with ground/landscape.' },
      { name: 'right', description: 'RIGHT face (right side view at eye level). Top edge connects to the sky above. Show horizon with ground/landscape.' }
    ];

    const generateHorizonFace = async (face: { name: string; description: string }) => {
      const horizonPrompt = `Create the ${face.description} of a seamless 360° skybox cubemap for: ${prompt}.

REFERENCE IMAGE: The image I'm providing shows the TOP/sky view. Your ${face.name} face must match its colors, lighting, and atmosphere.

CRITICAL ALIGNMENT:
- Top edge of your image MUST blend seamlessly with the provided sky image
- Match the sky color, clouds, and lighting from the reference
- The upper portion should gradually transition from the reference sky
- Left and right edges must connect smoothly to adjacent horizon faces

VIEWING ANGLE: Eye-level horizon view looking ${face.name}.
STYLE: Ultra high quality, photorealistic, 1024x1024, seamless tileable texture.`;

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
              content: [
                { type: 'text', text: horizonPrompt },
                { type: 'image_url', image_url: { url: topImageUrl } }
              ]
            }
          ],
          modalities: ['image', 'text']
        }),
      });

      if (!response.ok) {
        if (response.status === 429) throw new Error('RATE_LIMIT');
        if (response.status === 402) throw new Error('PAYMENT_REQUIRED');
        throw new Error(`Failed to generate ${face.name} face`);
      }

      const data = await response.json();
      const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      if (!imageUrl) throw new Error(`Failed to get ${face.name} image`);
      
      console.log(`Successfully generated ${face.name} face`);
      return imageUrl;
    };

    const horizonImages = await Promise.all(horizonFaces.map(face => generateHorizonFace(face)));
    const [frontImage, backImage, leftImage, rightImage] = horizonImages;

    // Step 3: Generate BOTTOM face referencing TOP and FRONT
    const bottomPrompt = `Create the BOTTOM face of a seamless 360° skybox cubemap for: ${prompt}.

REFERENCE IMAGES: The first image shows the TOP/sky, the second shows the FRONT horizon view.

VIEWING ANGLE: Looking straight DOWN at the ground/nadir from inside a cube.
CONTENT: Ground, terrain, or abstract pattern below (NOT sky).
ALIGNMENT: All 4 edges must blend with the bottom edges of horizon faces.
COLOR MATCHING: If the ground is visible in the front view, use similar colors/textures.

STYLE: Ultra high quality, photorealistic, 1024x1024, seamless tileable texture.`;

    console.log('Generating BOTTOM face...');
    const bottomResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
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
            content: [
              { type: 'text', text: bottomPrompt },
              { type: 'image_url', image_url: { url: topImageUrl } },
              { type: 'image_url', image_url: { url: frontImage } }
            ]
          }
        ],
        modalities: ['image', 'text']
      }),
    });

    if (!bottomResponse.ok) {
      if (bottomResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (bottomResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: 'Payment required. Please add credits to your workspace.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw new Error('Failed to generate BOTTOM face');
    }

    const bottomData = await bottomResponse.json();
    const bottomImage = bottomData.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!bottomImage) throw new Error('Failed to get BOTTOM image');
    console.log('Successfully generated BOTTOM face');

    const generatedImages = [
      topImageUrl,    // 0: top
      bottomImage,    // 1: bottom
      frontImage,     // 2: front
      backImage,      // 3: back
      leftImage,      // 4: left
      rightImage      // 5: right
    ];

    console.log('All faces generated successfully with image references');

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
