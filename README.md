# WITHIN Glide

**WITHIN Glide** is an internal AI-powered creative tool built by [WITHIN](https://www.within.co) for generating, editing, and composing images and videos using a visual node-based canvas.

---

## What It Is

Glide gives creative teams a drag-and-drop canvas where AI models are wired together as nodes. Instead of using AI tools one prompt at a time, you build reusable workflows — chain a prompt into an image generator, pass that image into an upscaler, branch it into a background remover, and route the result to an output or gallery, all without writing any code.

It is designed for internal use at WITHIN, with Google OAuth login restricted to `@within.co` accounts and an admin approval gate for new users.

---

## How It Works

### The Canvas

The main workspace is a React Flow canvas where every operation is a **node**. Nodes have typed input and output ports (image, video, prompt) that enforce compatible connections. You build a workflow by connecting nodes with edges — the output of one node feeds the input of the next.

Workflows are saved automatically as flows, each with a thumbnail preview, and can be opened from the Canvas Flow dashboard page.

### Node Types

| Node | What it does |
|------|-------------|
| **Prompt** | Text prompt that live-syncs to any connected generation node |
| **Image Input** | Upload or drag-in a reference image |
| **Video Input** | Upload a source video |
| **Media Input** | Upload either an image or video from a single node |
| **Image Generation** | Generate images from a text prompt using a selected model |
| **Video Generation** | Generate videos from a text prompt or start/end frame images |
| **Modify** | Edit an existing image with a prompt (inpaint/restyle) or expand its canvas (outpaint) |
| **Upscale** | Upscale an image with AI (SeedVR2 or Topaz) |
| **Upscale Media** | Upscale either an image or video through a single node |
| **Video Upscale** | AI upscale for videos |
| **Remove Background** | Remove the background from an image |
| **Image to Prompt** | Reverse-engineer a text prompt from an image |
| **Select** | Pick one image from a batch |
| **Video to GIF** | Convert a video clip to an animated GIF with configurable FPS and size |
| **Output** | Preview and download the final image or video |
| **Gallery Output** | Route multiple results into a scrollable gallery |
| **Group** | Group nodes together for organisation |

### AI Models

All generation runs through the [FAL AI](https://fal.ai) platform.

| Model | Type |
|-------|------|
| Nano Banana 2 | Image generation |
| Nano Banana Pro | Image generation |
| Seedream v5 (ByteDance) | Image generation and editing |
| GPT Image 2 (OpenAI) | Image generation |
| Qwen Image 3.0 (Alibaba) | Image generation and editing |
| Krea 2 Large | Image generation with style references |
| Recraft V4 | Image generation with style references |
| FLUX 2 Pro | Image generation |
| Google Omni Flash | Image-to-video generation |
| Kling 3 Pro | Video generation |
| Seedance 2.0 / 2.5 (ByteDance) | Video generation |
| SeedVR2 | Image / video upscale |
| Topaz | Image upscale |
| Ideogram Remove Background | Background removal |
| FLUX 2 Pro Outpaint | Canvas expansion |

### Storage

All generated media is stored in **Google Cloud Storage**. Files are never served directly through the Next.js server.

### Figma Integration

A companion Figma plugin can receive GIFs sent directly from the canvas. Users generate a link token in Settings, paste it into the plugin once, and any GIF exported from the canvas is pushed to their Figma clipboard automatically.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| UI | React 19, Tailwind CSS 4 |
| Canvas | React Flow (`@xyflow/react`) |
| State | Zustand |
| Auth & Database | Supabase (Postgres + Row Level Security) |
| Storage | Google Cloud Storage |
| AI inference | FAL AI |
| Image processing | Sharp (server), browser-image-compression (client) |
| Video processing | FFmpeg (WASM) |
| Deployment | Vercel |

---

## Dashboard Pages

- **Canvas Flow** — Create and open node-based AI workflows
- **Gallery** — Browse all generated images and videos with filtering and pagination
- **Image & Video** — Lightweight prompt-to-image/video interface without the canvas
- **Settings** — Profile (username), appearance, Figma integration token
- **Admin → All Usage** — Generation counts, model usage, user activity, and hourly traffic charts (admin only)
- **Admin → Users** — User management and approval (admin only)

---

## Local Development

### Prerequisites

- Node.js 18+
- A Supabase project
- A Google Cloud Storage bucket with a service account key
- A FAL AI API key

### Environment Variables

Create a `.env.local` file at the root:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GCS_BUCKET_NAME=
GCS_CREDENTIALS_JSON=      # full service account JSON, paste as a single line
FAL_KEY=
```

### Running

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### GCS CORS Setup

The first time you set up the bucket, configure CORS so browsers can PUT files directly:

```bash
npm run setup-gcs-cors
```

---

## Deployment

The app is deployed on **Vercel**. Push to `main` triggers a production deploy automatically.

```bash
git push origin main
```

Repository: [github.com/santiagovz-within/within-glide](https://github.com/santiagovz-within/within-glide)
