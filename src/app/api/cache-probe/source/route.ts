const LOGIN_IMAGE_ENDPOINT =
  'https://within-glide.vercel.app/api/settings/login-image';

export async function GET() {
  const settingsResponse = await fetch(LOGIN_IMAGE_ENDPOINT, {
    cache: 'no-store',
  });
  if (!settingsResponse.ok) {
    return new Response('Could not resolve probe image', { status: 502 });
  }

  const payload = (await settingsResponse.json()) as { url?: string };
  if (!payload.url) {
    return new Response('Probe image is not configured', { status: 404 });
  }

  const imageResponse = await fetch(payload.url, { cache: 'no-store' });
  if (!imageResponse.ok || !imageResponse.body) {
    return new Response('Could not load probe image', { status: 502 });
  }

  return new Response(imageResponse.body, {
    headers: {
      'Cache-Control': 'private, max-age=604800, immutable',
      'Content-Type': imageResponse.headers.get('content-type') ?? 'image/jpeg',
    },
  });
}
