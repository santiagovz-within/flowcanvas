import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { GoogleGenAI } from '@google/genai';
import { getSignedReadUrl } from '@/lib/gcs';
import { uploadMediaToGCS } from '@/lib/mediaDerivatives';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { prompt, aspectRatio = '16:9', sourceType, sourceId, nodeId } = await request.json();

    const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });

    const operation = await ai.models.generateVideos({
      model: 'veo-3.0',
      prompt,
      config: {
        aspectRatio: aspectRatio === '16:9' ? 'LANDSCAPE' : aspectRatio === '9:16' ? 'PORTRAIT' : 'LANDSCAPE',
      },
    });

    let pollOp = operation;
    let attempts = 0;
    while (!pollOp.done && attempts < 60) {
      await new Promise((r) => setTimeout(r, 5000));
      pollOp = await ai.operations.getVideosOperation({ operation: pollOp });
      attempts++;
    }

    if (!pollOp.done || !pollOp.response?.generatedVideos?.[0]) {
      return NextResponse.json({ error: 'Video generation failed or timed out' }, { status: 500 });
    }

    const videoData = pollOp.response.generatedVideos[0];
    const videoUri = videoData.video?.uri;
    if (!videoUri) return NextResponse.json({ error: 'No video URI returned' }, { status: 500 });

    const videoRes = await fetch(videoUri, {
      headers: { Authorization: `Bearer ${process.env.GOOGLE_AI_API_KEY}` },
    });
    const videoBuffer = await videoRes.arrayBuffer();

    const genId = crypto.randomUUID();
    const objectPath = `${user.id}/${genId}.mp4`;
    const gcsRef = await uploadMediaToGCS(videoBuffer, objectPath, 'video/mp4');
    const signedUrl = await getSignedReadUrl(objectPath);

    const { data: gen } = await supabase
      .from('generations')
      .insert({
        id: genId,
        user_id: user.id,
        source_type: sourceType ?? 'chat',
        source_id: sourceId,
        node_id: nodeId,
        model: 'veo-3.1',
        prompt,
        parameters: { aspectRatio },
        media_type: 'video',
        media_url: gcsRef,
        status: 'completed',
      })
      .select()
      .single();

    return NextResponse.json({ generationId: gen?.id, mediaUrls: [signedUrl], status: 'completed' });
  } catch (err) {
    console.error('Veo generation error:', err);
    return NextResponse.json({ error: 'Video generation failed', details: String(err) }, { status: 500 });
  }
}
