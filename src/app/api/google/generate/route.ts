import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { GoogleGenAI } from '@google/genai';
import { GOOGLE_IMAGE_MODELS } from '@/lib/api/models';
import { getSignedReadUrl } from '@/lib/gcs';
import { uploadMediaToGCS } from '@/lib/mediaDerivatives';

interface GenerateBody {
  model: string;
  prompt: string;
  aspectRatio?: string;
  numImages?: number;
  referenceImageUrls?: string[];
  sourceType: 'canvas' | 'chat';
  sourceId?: string;
  nodeId?: string;
}

async function fetchAsInlineData(url: string) {
  const res = await fetch(url);
  const buffer = await res.arrayBuffer();
  const mimeType = res.headers.get('content-type') ?? 'image/jpeg';
  return { inlineData: { data: Buffer.from(buffer).toString('base64'), mimeType } };
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body: GenerateBody = await request.json();
    const {
      model,
      prompt,
      aspectRatio = '1:1',
      numImages = 1,
      referenceImageUrls = [],
      sourceType,
      sourceId,
      nodeId,
    } = body;

    const googleModelId = GOOGLE_IMAGE_MODELS[model];
    if (!googleModelId) {
      return NextResponse.json({ error: `Unknown Google model: ${model}` }, { status: 400 });
    }

    console.log('[google/generate] model:', googleModelId, '| refs:', referenceImageUrls.length, '| prompt:', prompt.slice(0, 80));

    const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });

    const validRefUrls = referenceImageUrls.filter(Boolean);
    const imageParts = validRefUrls.length > 0
      ? await Promise.all(validRefUrls.map(fetchAsInlineData))
      : [];

    const aspectHint = aspectRatio !== '1:1' ? ` Use a ${aspectRatio} aspect ratio.` : '';
    const fullPrompt = prompt + aspectHint;

    const mediaUrls: string[] = [];

    for (let i = 0; i < numImages; i++) {
      const response = await ai.models.generateContent({
        model: googleModelId,
        contents: [{
          role: 'user',
          parts: [{ text: fullPrompt }, ...imageParts],
        }],
        config: { responseModalities: ['TEXT', 'IMAGE'] },
      });

      const parts = response.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if (!part.inlineData?.data) continue;

        const imageBytes = part.inlineData.data;
        const mimeType = part.inlineData.mimeType ?? 'image/png';
        const ext = mimeType.split('/')[1] ?? 'png';
        const binary = Buffer.from(imageBytes, 'base64');

        const genId = crypto.randomUUID();
        const objectPath = `${user.id}/${genId}.${ext}`;
        const gcsRef = await uploadMediaToGCS(binary, objectPath, mimeType);
        const signedUrl = await getSignedReadUrl(objectPath);

        await supabase.from('generations').insert({
          id: genId,
          user_id: user.id,
          source_type: sourceType,
          source_id: sourceId,
          node_id: nodeId,
          model,
          prompt,
          parameters: { aspectRatio, referenceCount: imageParts.length },
          media_type: 'image',
          media_url: gcsRef,
          status: 'completed',
        });

        mediaUrls.push(signedUrl);
        break;
      }
    }

    if (mediaUrls.length === 0) {
      return NextResponse.json({ error: 'No images returned by the model' }, { status: 500 });
    }

    return NextResponse.json({ mediaUrls, status: 'completed' });
  } catch (err) {
    const details = err instanceof Error ? err.message : JSON.stringify(err);
    console.error('Google generate error:', details);
    return NextResponse.json({ error: 'Generation failed', details }, { status: 500 });
  }
}
