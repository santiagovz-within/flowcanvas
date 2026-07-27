'use client';

import { useEffect, useCallback, useState, useRef } from 'react';
import { useChatStore } from '@/lib/stores/chatStore';
import { useGalleryStore } from '@/lib/stores/galleryStore';
import { createClient } from '@/lib/supabase/client';
import { SessionList } from '@/components/chat/SessionList';
import { ChatInput } from '@/components/chat/ChatInput';
import { GenerationCard } from '@/components/chat/GenerationCard';
import { GenerationModal } from '@/components/chat/GenerationModal';
import { MODELS } from '@/lib/api/models';
import type { ChatSession, ChatMessage, Generation } from '@/types';

export default function ImageVideoPage() {
  const {
    sessions, setSessions, addSession,
    activeSessionId, setActiveSessionId,
    messages, setMessages, addMessage,
    generations, addGeneration, updateGeneration,
    prompt, referenceImages,
    settings, mode,
    isGenerating, setIsGenerating,
    setPrompt, setReferenceImages,
    updateSession, addReferenceImage,
  } = useChatStore();
  const [selectedGen, setSelectedGen] = useState<Generation | null>(null);
  const [copiedToast, setCopiedToast] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { addGeneration: addToGallery } = useGalleryStore();

  const supabase = createClient();

  // Ref so loadSessions doesn't need activeSessionId in its deps (avoids reload loop)
  const activeSessionIdRef = useRef<string | null>(activeSessionId);
  useEffect(() => { activeSessionIdRef.current = activeSessionId; }, [activeSessionId]);

  const loadSessions = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('chat_sessions')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });
    setSessions(data ?? []);
    if (data?.[0] && !activeSessionIdRef.current) {
      setActiveSessionId(data[0].id);
    }
  }, [supabase, setSessions, setActiveSessionId]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (!activeSessionId) return;
    async function loadMessages() {
      const { data: msgs } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('session_id', activeSessionId)
        .order('created_at', { ascending: true });
      if (msgs) setMessages(activeSessionId!, msgs);

      // Load generations for these messages
      const genIds = msgs?.flatMap((m: ChatMessage) => m.generation_ids ?? []) ?? [];
      if (genIds.length > 0) {
        const { data: gens } = await supabase
          .from('generations')
          .select('*')
          .in('id', genIds);
        gens?.forEach((g: Generation) => addGeneration(g));
      }
    }
    loadMessages();
  }, [activeSessionId, supabase, setMessages, addGeneration]);

  async function createNewSession(): Promise<string | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase
      .from('chat_sessions')
      .insert({ user_id: user.id, title: 'New Session' })
      .select()
      .single();
    if (data) {
      addSession(data as ChatSession);
      setActiveSessionId(data.id);
      return data.id;
    }
    return null;
  }

  function handleCopyPrompt(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      setCopiedToast(true);
      copiedTimerRef.current = setTimeout(() => setCopiedToast(false), 1800);
    }).catch(() => {});
  }

  async function handleGenerate() {
    if (!prompt.trim() || isGenerating) return;

    let sessionId = activeSessionId;
    if (!sessionId) {
      sessionId = await createNewSession();
      if (!sessionId) return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    setIsGenerating(true);

    // Capture before any async saves so values are stable
    const capturedPrompt = prompt;
    const capturedRefImages = [...referenceImages];

    // Save user message (include reference images for display in history)
    const { data: userMsg } = await supabase
      .from('chat_messages')
      .insert({
        session_id: sessionId,
        user_id: user.id,
        role: 'user',
        content: capturedPrompt,
        generation_ids: [],
        reference_image_urls: capturedRefImages.length > 0 ? capturedRefImages : null,
      })
      .select()
      .single();
    if (userMsg) addMessage(sessionId, userMsg as ChatMessage);

    // Fire-and-forget title generation on first message
    const sessionMessages = messages[sessionId] ?? [];

    if (sessionMessages.length === 0) {
      fetch('/api/google/generate-title', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: capturedPrompt }),
      }).then(r => r.json()).then(async ({ title }) => {
        if (title && title !== 'New Session') {
          await supabase.from('chat_sessions').update({ title, updated_at: new Date().toISOString() }).eq('id', sessionId!);
          updateSession(sessionId!, { title });
        }
      }).catch(() => {});
    }

    try {
      const modelConfig = MODELS[settings.model];
      const isGoogleImageModel = mode === 'image' && modelConfig?.provider === 'google';
      const endpoint = isGoogleImageModel ? '/api/google/generate' : '/api/fal/generate';
      const count = mode === 'image' ? settings.numGenerations : 1;

      const generationIds: string[] = [];

      for (let i = 0; i < count; i++) {
        const body = mode === 'image'
          ? {
              model: settings.model,
              prompt: capturedPrompt,
              aspectRatio: settings.aspectRatio,
              resolution: settings.resolution,
              numImages: 1,
              referenceImageUrls: capturedRefImages,
              sourceType: 'chat',
              sourceId: sessionId,
            }
          : {
              model: settings.model,
              prompt: capturedPrompt,
              aspectRatio: settings.aspectRatio,
              duration: settings.duration ?? 5,
              startFrameUrl: capturedRefImages[0] ?? undefined,
              endFrameUrl: capturedRefImages[1] ?? undefined,
              sourceType: 'chat',
              sourceId: sessionId,
            };

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const result = await res.json() as {
          generationId?: string;
          requestId?: string;
          endpoint?: string;
          status?: string;
          requests?: Array<{ requestId: string; generationId?: string; endpoint: string }>;
        };

        if (result.generationId) {
          generationIds.push(result.generationId);

          // Load the saved generation from DB
          const { data: gen } = await supabase
            .from('generations')
            .select('*')
            .eq('id', result.generationId)
            .single();
          if (gen) {
            addGeneration(gen as Generation);
            addToGallery(gen as Generation);

            // Set session thumbnail from the first generated image
            const currentSession = sessions.find(s => s.id === sessionId);
            if (!currentSession?.thumbnail_url && gen.media_url) {
              await supabase.from('chat_sessions').update({ thumbnail_url: gen.media_url }).eq('id', sessionId!);
              updateSession(sessionId!, { thumbnail_url: gen.media_url });
            }
          }
        }

        const pendingRequest = result.requests?.[0];
        const requestId = pendingRequest?.requestId ?? result.requestId;
        const requestEndpoint = pendingRequest?.endpoint ?? result.endpoint;

        // Handle queued image and video generation
        if (requestId && result.status === 'pending') {
          // Poll
          let attempts = 0;
          const pollInterval = setInterval(async () => {
            attempts++;
            if (attempts > 100) { clearInterval(pollInterval); return; }
            const query = new URLSearchParams();
            if (requestEndpoint) query.set('endpoint', requestEndpoint);
            if (mode === 'image') query.set('mediaType', 'image');
            const statusRes = await fetch(`/api/fal/status/${requestId}?${query.toString()}`);
            const status = await statusRes.json();
            if (status.status === 'completed' && status.generationId) {
              clearInterval(pollInterval);
              const { data: gen } = await supabase
                .from('generations')
                .select('*')
                .eq('id', status.generationId)
                .single();
              if (gen) {
                if (!generationIds.includes(status.generationId)) {
                  generationIds.push(status.generationId);
                }
                addGeneration(gen as Generation);
                addToGallery(gen as Generation);
                updateGeneration(status.generationId, gen as Partial<Generation>);
              }
            }
          }, 3000);
        }
      }

      // Save system message with generation IDs
      if (generationIds.length > 0) {
        const { data: sysMsg } = await supabase
          .from('chat_messages')
          .insert({
            session_id: sessionId,
            user_id: user.id,
            role: 'system',
            content: null,
            generation_ids: generationIds,
          })
          .select()
          .single();
        if (sysMsg) addMessage(sessionId, sysMsg as ChatMessage);
      }
    } catch (err) {
      console.error('Generation failed:', err);
    } finally {
      setIsGenerating(false);
    }
  }

  const activeMessages = activeSessionId ? (messages[activeSessionId] ?? []) : [];

  return (
    <div className="flex h-full overflow-hidden">
      <SessionList onNewSession={createNewSession} />

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Copied toast */}
        <div
          className="absolute top-4 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-full text-xs font-medium pointer-events-none select-none"
          style={{
            background: 'var(--color-bg-elevated)',
            border: 'var(--border-default)',
            color: 'var(--color-white)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
            opacity: copiedToast ? 1 : 0,
            transform: `translateX(-50%) translateY(${copiedToast ? 0 : -6}px)`,
            transition: 'opacity 0.18s ease, transform 0.18s ease',
          }}
        >
          Copied to clipboard
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {!activeSessionId ? (
            <div className="flex flex-col items-center justify-center h-full">
              <div className="text-center max-w-sm">
                <p className="text-xl font-semibold mb-2" style={{ color: 'var(--color-white)' }}>
                  Start generating
                </p>
                <p className="text-sm" style={{ color: 'var(--color-white-muted)' }}>
                  Type a prompt below to generate images or videos
                </p>
              </div>
            </div>
          ) : activeMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full">
              <p className="text-sm" style={{ color: 'var(--color-white-muted)' }}>
                No messages yet. Start generating below.
              </p>
            </div>
          ) : (
            activeMessages.map((msg) => (
              <div key={msg.id} className={msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                {msg.role === 'user' ? (
                  <div className="flex items-end gap-2 max-w-lg">
                    {(msg.reference_image_urls ?? []).length > 0 && (
                      <RefImageStack
                        urls={msg.reference_image_urls!}
                        onImageClick={(url) => addReferenceImage(url)}
                      />
                    )}
                    <div
                      className="px-4 py-3 rounded-2xl rounded-tr-sm cursor-pointer transition-opacity hover:opacity-75 select-none"
                      style={{ background: 'var(--color-bg-elevated)', border: 'var(--border-default)' }}
                      onClick={() => msg.content && handleCopyPrompt(msg.content)}
                      title="Click to copy prompt"
                    >
                      <p className="text-sm" style={{ color: 'var(--color-white)' }}>{msg.content}</p>
                    </div>
                  </div>
                ) : (
                  <div className="max-w-2xl w-full">
                    <div
                      className="grid gap-3"
                      style={{
                        gridTemplateColumns: `repeat(${Math.min((msg.generation_ids?.length ?? 0), 2)}, 1fr)`,
                      }}
                    >
                      {(msg.generation_ids ?? []).map((genId) => {
                        const gen = generations[genId];
                        if (!gen) return (
                          <div
                            key={genId}
                            className="rounded-xl animate-pulse"
                            style={{ aspectRatio: '1', background: 'var(--color-bg-elevated)' }}
                          />
                        );
                        return (
                          <GenerationCard
                            key={genId}
                            generation={gen}
                            onClick={() => setSelectedGen(gen)}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Input */}
        <ChatInput onSubmit={handleGenerate} />
      </div>

      {/* Generation detail modal */}
      {selectedGen && (
        <GenerationModal generation={selectedGen} onClose={() => setSelectedGen(null)} />
      )}
    </div>
  );
}

const REF_ROTATIONS = [-7, 5, -9, 6];

function RefImageStack({ urls, onImageClick }: { urls: string[]; onImageClick?: (url: string) => void }) {
  const visible = urls.slice(0, 3);
  const extra = urls.length > 3 ? urls.length - 3 : 0;

  return (
    <div className="flex items-center" style={{ paddingBottom: 2 }}>
      {visible.map((url, idx) => (
        <div
          key={idx}
          className="shrink-0 rounded overflow-hidden"
          style={{
            width: 26,
            height: 26,
            position: 'relative',
            marginLeft: idx > 0 ? -8 : 0,
            zIndex: idx + 1,
            transform: `rotate(${REF_ROTATIONS[idx]}deg)`,
            border: '1.5px solid rgba(0,0,0,0.55)',
            boxShadow: '0 1px 4px rgba(0,0,0,0.45)',
            borderRadius: 5,
            cursor: onImageClick ? 'pointer' : 'default',
            transition: 'transform 0.12s ease, box-shadow 0.12s ease',
          }}
          onClick={() => onImageClick?.(url)}
          title={onImageClick ? 'Click to attach' : undefined}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        </div>
      ))}
      {extra > 0 && (
        <div
          className="shrink-0 flex items-center justify-center"
          style={{
            width: 26,
            height: 26,
            position: 'relative',
            marginLeft: -8,
            zIndex: visible.length + 1,
            transform: `rotate(${REF_ROTATIONS[visible.length % REF_ROTATIONS.length]}deg)`,
            background: 'var(--color-bg-surface)',
            border: '1.5px solid rgba(0,0,0,0.55)',
            boxShadow: '0 1px 4px rgba(0,0,0,0.45)',
            borderRadius: 5,
            fontSize: 9,
            fontWeight: 600,
            color: 'var(--color-white-muted)',
            letterSpacing: '0.02em',
          }}
        >
          +{extra}
        </div>
      )}
    </div>
  );
}
