import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { GoogleGenAI } from '@google/genai';

async function fetchAsInlineData(url: string) {
  const res = await fetch(url);
  const buffer = await res.arrayBuffer();
  const mimeType = res.headers.get('content-type') ?? 'image/jpeg';
  return { inlineData: { data: Buffer.from(buffer).toString('base64'), mimeType } };
}

// POST /api/google/image-to-prompt
// Analyzes an image and returns a descriptive text-to-image prompt.
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { imageUrl, length = 'auto' } = await request.json();
    if (!imageUrl) return NextResponse.json({ error: 'imageUrl is required' }, { status: 400 });

    const lengthInstruction: Record<string, string> = {
      auto:   'Write a detailed, accurate text-to-image prompt that would recreate it. Describe the subject, composition, lighting, style, colors, and mood. Be precise and specific.',
      short:  'Write a concise text-to-image prompt in 1–2 sentences capturing the essential subject, style, and mood.',
      medium: 'Write a text-to-image prompt of moderate detail (around 40–60 words) covering the subject, composition, lighting, and style.',
      long:   'Write a comprehensive, highly detailed text-to-image prompt (80+ words) covering every visual element: subject, pose, composition, lighting, color palette, textures, background, style, and mood.',
    };

    const instruction = lengthInstruction[length] ?? lengthInstruction.auto;

    const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });
    const imagePart = await fetchAsInlineData(imageUrl);

    const response = await ai.models.generateContent({
      model: 'gemini-3.7-flash',
      contents: [{
        role: 'user',
        parts: [
          imagePart,
          {
            text: `Analyze this image and ${instruction} Return only the prompt text, nothing else.`,
          },
        ],
      }],
    });

    const prompt = response.text?.trim();
    if (!prompt) return NextResponse.json({ error: 'No prompt generated' }, { status: 500 });

    return NextResponse.json({ prompt });
  } catch (err) {
    const details = err instanceof Error ? err.message : JSON.stringify(err);
    console.error('[image-to-prompt] error:', details);
    return NextResponse.json({ error: 'Analysis failed', details }, { status: 500 });
  }
}
