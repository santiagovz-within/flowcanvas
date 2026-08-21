import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { GoogleGenAI } from '@google/genai';
import { signStoredThumbnail } from '@/lib/gcs';

const UNTITLED = 'Untitled Flow';

async function fetchAsInlineData(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Thumbnail fetch failed (${res.status})`);
  const buffer = await res.arrayBuffer();
  const mimeType = res.headers.get('content-type') ?? 'image/jpeg';
  return { inlineData: { data: Buffer.from(buffer).toString('base64'), mimeType } };
}

/** Clamps the model output to a clean 1–4 word title. */
function sanitizeTitle(raw: string | undefined): string | null {
  const words = (raw ?? '')
    .replace(/["'.،。]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);
  if (words.length === 0) return null;
  const title = words.join(' ').slice(0, 60);
  return title === UNTITLED ? null : title;
}

// POST /api/google/generate-flow-title
// Names a flow that is still "Untitled Flow" after its first generation by
// describing its thumbnail with Gemini. Returns { title } — the freshly
// generated one, or the current title when nothing needed generating.
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { flowId } = await request.json();
    if (!flowId) return NextResponse.json({ error: 'flowId is required' }, { status: 400 });

    const { data: flow, error } = await supabase
      .from('flows')
      .select('id, title, thumbnail_url')
      .eq('id', flowId)
      .eq('user_id', user.id)
      .single();

    if (error || !flow) return NextResponse.json({ error: 'Flow not found' }, { status: 404 });
    if (flow.title !== UNTITLED || !flow.thumbnail_url) {
      return NextResponse.json({ title: flow.title, generated: false });
    }

    const thumbnailUrl = await signStoredThumbnail(flow.thumbnail_url);
    if (!thumbnailUrl) return NextResponse.json({ error: 'Thumbnail unavailable' }, { status: 422 });

    const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });
    const imagePart = await fetchAsInlineData(thumbnailUrl);

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash-lite',
      contents: [{
        role: 'user',
        parts: [
          imagePart,
          { text: 'This image is the thumbnail of a creative image/video generation flow. Give the flow a short, evocative title of one to four words that captures its subject. Return ONLY the title — no quotes, no punctuation, no explanation.' },
        ],
      }],
    });

    const title = sanitizeTitle(response.text);
    if (!title) return NextResponse.json({ error: 'No title generated' }, { status: 500 });

    // Guarded on the placeholder title so a rename that landed while Gemini
    // was thinking is never overwritten. updated_at is left untouched — an
    // auto-title should not bump the flow up the recency ordering.
    const { data: updated } = await supabase
      .from('flows')
      .update({ title })
      .eq('id', flowId)
      .eq('user_id', user.id)
      .eq('title', UNTITLED)
      .select('title')
      .single();

    return NextResponse.json({ title: updated?.title ?? title, generated: !!updated });
  } catch (err) {
    const details = err instanceof Error ? err.message : JSON.stringify(err);
    console.error('[generate-flow-title] error:', details);
    return NextResponse.json({ error: 'Title generation failed', details }, { status: 500 });
  }
}
