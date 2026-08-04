'use client';

import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  useReactFlow,
  Panel,
  type Node,
  type Connection,
  type IsValidConnection,
  type Edge,
  type EdgeChange,
  type OnConnectStart,
  type FinalConnectionState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useFlowStore } from '@/lib/stores/flowStore';
import { useMediaLodStore } from '@/lib/stores/mediaLodStore';
import { useThemeStore } from '@/lib/stores/themeStore';
import { PromptNode } from './nodes/PromptNode';
import { ImageInputNode } from './nodes/ImageInputNode';
import { ImageToPromptNode } from './nodes/ImageToPromptNode';
import { ImageGenNode } from './nodes/ImageGenNode';
import { VideoGenNode } from './nodes/VideoGenNode';
import { UpscaleNode } from './nodes/UpscaleNode';
import { ModifyNode } from './nodes/ModifyNode';
import { SelectNode } from './nodes/SelectNode';
import { OutputNode } from './nodes/OutputNode';
import { GalleryOutputNode } from './nodes/GalleryOutputNode';
import { VideoToGifNode } from './nodes/VideoToGifNode';
import { RemoveBgNode } from './nodes/RemoveBgNode';
import { VideoInputNode } from './nodes/VideoInputNode';
import { MediaInputNode } from './nodes/MediaInputNode';
import { UpscaleMediaNode } from './nodes/UpscaleMediaNode';
import { VideoUpscaleNode } from './nodes/VideoUpscaleNode';
import { GroupNode } from './nodes/GroupNode';
import { CustomEdge } from './edges/CustomEdge';
import { NodeToolbar } from './NodeToolbar';
import { PORT_TYPE_MAP } from './nodes/TypedHandle';
import {
  getActiveMediaSourceHandle,
  getNodeMediaUrls,
  getSourceMediaType,
} from './mediaOutputs';
import type { NodeType, NodeData, ImageGenNodeData, ImageToPromptNodeData, MediaInputNodeData } from '@/types';
import { getImageReferenceLimit } from '@/lib/api/models';
import { processImageFile } from '@/lib/utils/imageProcessing';
import { uploadImageToStorage } from '@/lib/utils/uploadImage';
import { setPendingFile } from '@/lib/utils/pendingFiles';

const nodeTypes = {
  promptNode: PromptNode,
  imageInputNode: ImageInputNode,
  imageToPromptNode: ImageToPromptNode,
  imageGenNode: ImageGenNode,
  videoGenNode: VideoGenNode,
  upscaleNode: UpscaleNode,
  modifyNode: ModifyNode,
  selectNode: SelectNode,
  outputNode: OutputNode,
  galleryOutputNode: GalleryOutputNode,
  videoToGifNode: VideoToGifNode,
  removeBgNode: RemoveBgNode,
  videoInputNode: VideoInputNode,
  mediaInputNode: MediaInputNode,
  upscaleMediaNode: UpscaleMediaNode,
  videoUpscaleNode: VideoUpscaleNode,
  groupNode: GroupNode,
};

const edgeTypes = {
  default: CustomEdge,
};

const DEFAULT_NODE_DATA: Record<NodeType, NodeData> = {
  promptNode:         { prompt: '' },
  imageInputNode:     {},
  imageToPromptNode:  { status: 'idle' },
  imageGenNode:       { model: 'nano-banana-2', aspectRatio: '1:1', resolution: '1K', numImages: 1, status: 'idle', inputImageUrls: [], imagePortCount: 0 },
  videoGenNode:       { model: 'google-omni-flash', aspectRatio: '16:9', duration: 5, status: 'idle' },
  upscaleNode:        { model: 'seedvr2', scaleFactor: 2, status: 'idle' },
  modifyNode:         { model: 'nano-banana-2', aspectRatio: '1:1', resolution: '1K', status: 'idle' },
  selectNode:         {},
  outputNode:         {},
  galleryOutputNode:  {},
  videoToGifNode:     { fps: 12, outputWidth: 480, startTime: 0, duration: 10, ditherLevel: 4 },
  removeBgNode:       { status: 'idle' },
  videoInputNode:     {},
  mediaInputNode:     {},
  upscaleMediaNode:   { model: 'seedvr2', scaleFactor: 2, upscaleFactor: 2, status: 'idle' },
  videoUpscaleNode:   { upscaleFactor: 2, status: 'idle' },
  groupNode:          { label: 'Group', color: 'Blue' },
};

interface ContextMenu { x: number; y: number; canvasX: number; canvasY: number; }
interface ConnectionToastState {
  message: string;
  tone: 'error' | 'success' | 'partial';
}

interface PendingConnection {
  nodeId: string;
  handleId: string | null;
  handleType: string | null;
  selectedNodeIds: string[];
}

// Fields that are derived from edges or represent generation output — must be
// stripped when pasting so a duplicated node starts in a blank state.
const PASTE_CLEAR_FIELDS = new Set([
  'outputImageUrl', 'outputVideoUrl',
  'inputImageUrl',
  'generatedImages',
  'generationSlots',
  'pendingRequests',
  'startFrameUrl', 'endFrameUrl',
  'generatedPrompt',
  'selectedImageUrl',
  'gifUrl',
  'promptConnected',
]);
// Input nodes own their media directly (user-uploaded) — keep it on paste.
const INPUT_NODE_TYPES = new Set(['imageInputNode', 'videoInputNode', 'mediaInputNode', 'promptNode']);

function pasteCleanData(nodeType: string | undefined, data: NodeData): NodeData {
  if (nodeType && INPUT_NODE_TYPES.has(nodeType)) return { ...data };
  const d = { ...data } as Record<string, unknown>;
  for (const f of PASTE_CLEAR_FIELDS) delete d[f];
  // Clear video that arrives via connection (not user-uploaded)
  if (nodeType !== 'videoInputNode' && nodeType !== 'mediaInputNode') delete d.videoUrl;
  // Reset array input ports
  if ('inputImageUrls' in d) d.inputImageUrls = [];
  if ('imagePortCount' in d) d.imagePortCount = 0;
  // Reset processing status
  if ('status' in d) d.status = 'idle';
  return d as NodeData;
}

function ConnectionToast({ toast }: { toast: ConnectionToastState | null }) {
  if (!toast) return null;
  const background = toast.tone === 'error'
    ? 'var(--color-error)'
    : toast.tone === 'success' ? 'var(--color-success)' : '#b45309';
  return (
    <div
      className="absolute bottom-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg text-xs font-medium pointer-events-none"
      style={{ background, color: '#fff', boxShadow: 'var(--shadow-node)' }}
    >
      {toast.message}
    </div>
  );
}

interface FlowCanvasProps {
  isTestUser?: boolean;
  readOnly?: boolean;
  focusNodeId?: string | null;
}

export function FlowCanvas({ isTestUser = false, readOnly = false, focusNodeId = null }: FlowCanvasProps) {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, addNode, updateNodeData, setNodes, setEdges } = useFlowStore();
  const theme = useThemeStore((s) => s.theme);
  const allowedTypes = isTestUser ? (['mediaInputNode', 'videoToGifNode'] as import('@/types').NodeType[]) : undefined;
  const { screenToFlowPosition, fitView } = useReactFlow();
  const [contextMenu, setContextMenu]   = useState<ContextMenu | null>(null);
  const [connectionToast, setConnectionToast] = useState<ConnectionToastState | null>(null);
  const [isDragOver, setIsDragOver]     = useState(false);
  const reactFlowWrapper                = useRef<HTMLDivElement>(null);
  const connectionToastTimer            = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clipboardRef                    = useRef<{ nodes: Node<NodeData>[]; edges: Edge[]; incomingEdges: Edge[] } | null>(null);
  const undoStack                       = useRef<{ nodes: Node<NodeData>[]; edges: Edge[] }[]>([]);
  const MAX_UNDO                        = 30;
  const nodesRef                        = useRef(nodes);
  const edgesRef                        = useRef(edges);
  const pendingConnectionRef            = useRef<PendingConnection | null>(null);
  const zoomSettleTimer                 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomInitTimer                   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cameraGestureActive             = useRef(false);
  const beginCameraMove                 = useMediaLodStore(state => state.beginCameraMove);
  const settleCamera                    = useMediaLodStore(state => state.settleCamera);
  const resetCamera                     = useMediaLodStore(state => state.resetCamera);

  const settleZoom = useCallback((zoom: number) => {
    if (zoomSettleTimer.current) clearTimeout(zoomSettleTimer.current);
    zoomSettleTimer.current = setTimeout(() => settleCamera(zoom), 140);
  }, [settleCamera]);

  const handleMoveStart = useCallback(() => {
    cameraGestureActive.current = true;
    if (zoomSettleTimer.current) clearTimeout(zoomSettleTimer.current);
    beginCameraMove();
  }, [beginCameraMove]);

  const handleMoveEnd = useCallback((zoom: number) => {
    cameraGestureActive.current = false;
    settleZoom(zoom);
  }, [settleZoom]);
  const lastFocusedNodeRef              = useRef<string | null>(null);

  useEffect(() => {
    if (!focusNodeId || lastFocusedNodeRef.current === focusNodeId) return;
    if (!nodes.some((node) => node.id === focusNodeId)) return;
    lastFocusedNodeRef.current = focusNodeId;
    const frame = window.requestAnimationFrame(() => {
      void fitView({
        nodes: [{ id: focusNodeId }],
        padding: 0.8,
        minZoom: 0.75,
        maxZoom: 1.1,
        duration: 500,
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fitView, focusNodeId, nodes]);

  const showConnectionToast = useCallback((toast: ConnectionToastState) => {
    if (connectionToastTimer.current) clearTimeout(connectionToastTimer.current);
    setConnectionToast(toast);
    connectionToastTimer.current = setTimeout(() => setConnectionToast(null), 3200);
  }, []);

  useEffect(() => () => {
    if (connectionToastTimer.current) clearTimeout(connectionToastTimer.current);
    if (zoomSettleTimer.current) clearTimeout(zoomSettleTimer.current);
    if (zoomInitTimer.current) clearTimeout(zoomInitTimer.current);
  }, []);

  useLayoutEffect(() => {
    // Prevent the default zoom of 1 from initiating oversized cold-start loads
    // before React Flow completes fitView.
    resetCamera();
  }, [resetCamera]);

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);

  // Listen for node data updates from child components
  useEffect(() => {
    function handleNodeUpdate(e: Event) {
      const { nodeId, data } = (e as CustomEvent).detail;
      updateNodeData(nodeId, data);
    }
    document.addEventListener('node:update', handleNodeUpdate);
    return () => document.removeEventListener('node:update', handleNodeUpdate);
  }, [updateNodeData]);

  // Live prompt propagation
  useEffect(() => {
    function handlePromptPropagate(e: Event) {
      const { sourceNodeId, prompt } = (e as CustomEvent).detail as { sourceNodeId: string; prompt: string };
      const connectedEdges = edges.filter(
        (edge) => edge.source === sourceNodeId && edge.sourceHandle === 'prompt'
      );
      for (const edge of connectedEdges) {
        updateNodeData(edge.target, { prompt });
      }
    }
    document.addEventListener('node:prompt-propagate', handlePromptPropagate);
    return () => document.removeEventListener('node:prompt-propagate', handlePromptPropagate);
  }, [edges, updateNodeData]);

  // ── Group selected nodes (Ctrl/Cmd+G) ───────────────────────────────────
  const groupSelectedNodes = useCallback(() => {
    const selectedNodes = nodesRef.current.filter((n) => n.selected && !n.parentId && n.type !== 'groupNode');
    if (selectedNodes.length < 2) return;

    const PADDING = 40;
    const DEFAULT_W = 300;
    const DEFAULT_H = 150;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of selectedNodes) {
      const w = (node.measured?.width as number | undefined) ?? DEFAULT_W;
      const h = (node.measured?.height as number | undefined) ?? DEFAULT_H;
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + w);
      maxY = Math.max(maxY, node.position.y + h);
    }

    const groupX = minX - PADDING;
    const groupY = minY - PADDING;
    const groupW = maxX - minX + PADDING * 2;
    const groupH = maxY - minY + PADDING * 2;

    const groupId = `groupNode-${Date.now()}`;

    const newGroupNode: Node<NodeData> = {
      id: groupId,
      type: 'groupNode',
      position: { x: groupX, y: groupY },
      style: { width: groupW, height: groupH },
      data: { label: 'Group', color: 'Blue' },
      selected: false,
    };

    const childIds = new Set(selectedNodes.map((n) => n.id));
    const updatedExisting = nodesRef.current.map((node) => {
      if (!childIds.has(node.id)) return node;
      return {
        ...node,
        parentId: groupId,
        position: { x: node.position.x - groupX, y: node.position.y - groupY },
        selected: false,
      };
    });

    // Group node must come first (renders behind children)
    const others   = updatedExisting.filter((n) => !childIds.has(n.id));
    const children = updatedExisting.filter((n) => childIds.has(n.id));
    setNodes([newGroupNode, ...others, ...children]);
  }, [setNodes]);

  // ── Copy / Paste / Delete keyboard shortcuts ─────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      if ((e.key === 'Delete' || e.key === 'Backspace') && !inInput) {
        const selectedNodeIds = new Set(nodesRef.current.filter((n) => n.selected).map((n) => n.id));
        const hasSelectedEdges = edgesRef.current.some((e) => e.selected);
        if (selectedNodeIds.size > 0 || hasSelectedEdges) {
          // Snapshot before destructive action so Ctrl+Z can restore it
          undoStack.current.push({ nodes: nodesRef.current, edges: edgesRef.current });
          if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();

          // Also remove children of deleted group nodes
          const allToRemove = new Set(selectedNodeIds);
          for (const n of nodesRef.current) {
            if (n.parentId && selectedNodeIds.has(n.parentId)) allToRemove.add(n.id);
          }

          // Compute per-edge downstream state clears for surviving target nodes.
          // We cannot call propagateImageToTarget here (stale closure / nodesRef race),
          // so we compute updates inline from fresh store state and merge into setNodes.
          const freshNodes = useFlowStore.getState().nodes;
          const freshNodeMap = new Map(freshNodes.map((n) => [n.id, n]));
          const edgesToRemove = edgesRef.current.filter(
            (edge) => edge.selected || allToRemove.has(edge.source) || allToRemove.has(edge.target)
          );
          const removedEdgeIds = new Set(edgesToRemove.map((ed) => ed.id));
          const nodeUpdates = new Map<string, Record<string, unknown>>();

          for (const edge of edgesToRemove) {
            if (allToRemove.has(edge.target)) continue; // target being deleted too
            const targetNode = freshNodeMap.get(edge.target);
            const sourceNode = freshNodeMap.get(edge.source);
            if (!targetNode) continue;
            const acc = nodeUpdates.get(edge.target) ?? {};
            const handle = edge.targetHandle ?? '';

            if (getSourceMediaType(sourceNode, edge.sourceHandle) === 'image') {
              const t = targetNode.type ?? '';
              if (t === 'upscaleNode' || t === 'modifyNode' || t === 'removeBgNode' || t === 'imageToPromptNode') {
                nodeUpdates.set(edge.target, { ...acc, inputImageUrl: undefined });
              } else if (t === 'videoGenNode') {
                if (handle === 'start_frame') nodeUpdates.set(edge.target, { ...acc, startFrameUrl: undefined });
                else if (handle === 'end_frame') nodeUpdates.set(edge.target, { ...acc, endFrameUrl: undefined });
              } else if (t === 'imageGenNode') {
                const currentData = targetNode.data as ImageGenNodeData;
                const urls = [...((acc.inputImageUrls as string[] | undefined) ?? currentData.inputImageUrls ?? [])];
                const idx = handle.startsWith('ref_') ? parseInt(handle.split('_')[1]) : 0;
                urls[idx] = '';
                const maxRefs = getImageReferenceLimit(currentData.model);
                const remainingIndexes = edgesRef.current
                  .filter((candidate) =>
                    !removedEdgeIds.has(candidate.id) &&
                    candidate.target === edge.target &&
                    candidate.targetHandle?.startsWith('ref_')
                  )
                  .map((candidate) => Number(candidate.targetHandle?.slice(4)))
                  .filter(Number.isInteger);
                const highestOccupied = remainingIndexes.length > 0 ? Math.max(...remainingIndexes) : -1;
                nodeUpdates.set(edge.target, {
                  ...acc,
                  inputImageUrls: urls,
                  imagePortCount: Math.min(Math.max(highestOccupied + 2, 1), maxRefs),
                });
              }
            }
            if (getSourceMediaType(sourceNode, edge.sourceHandle) === 'video' && (handle === 'video' || handle === 'video_in')) {
              nodeUpdates.set(edge.target, { ...acc, videoUrl: undefined });
            }
            if (edge.sourceHandle === 'prompt') {
              const stillHasPrompt = edgesRef.current.some(
                (e) => !removedEdgeIds.has(e.id) && e.target === edge.target && e.sourceHandle === 'prompt'
              );
              if (!stillHasPrompt) nodeUpdates.set(edge.target, { ...acc, promptConnected: false });
            }
          }

          setNodes(
            freshNodes
              .filter((n) => !allToRemove.has(n.id))
              .map((n) => {
                const upd = nodeUpdates.get(n.id);
                return upd ? { ...n, data: { ...n.data, ...upd } } : n;
              })
          );
          setEdges(edgesRef.current.filter(
            (edge) => !edge.selected && !allToRemove.has(edge.source) && !allToRemove.has(edge.target)
          ));
          e.preventDefault();
        }
        return;
      }

      const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
      const ctrlOrCmd = isMac ? e.metaKey : e.ctrlKey;
      if (!ctrlOrCmd) return;
      if (inInput) return;

      // Ctrl/Cmd + Z → undo last delete
      if (e.key === 'z' && !e.shiftKey) {
        const prev = undoStack.current.pop();
        if (prev) {
          setNodes(prev.nodes);
          setEdges(prev.edges);
        }
        e.preventDefault();
        return;
      }

      // Ctrl/Cmd + G → group
      if (e.key === 'g') {
        groupSelectedNodes();
        e.preventDefault();
        return;
      }

      if (e.key === 'c') {
        const selected = nodesRef.current.filter((n) => n.selected);
        if (selected.length === 0) return;
        const selectedIds = new Set(selected.map((n) => n.id));
        // Edges whose both ends are in the selection (copied as-is)
        const copiedEdges = edgesRef.current.filter(
          (edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target)
        );
        // Edges coming INTO selected nodes from non-selected sources — these
        // represent upstream connections that should re-attach on paste.
        const incomingEdges = edgesRef.current.filter(
          (edge) => !selectedIds.has(edge.source) && selectedIds.has(edge.target)
        );
        clipboardRef.current = { nodes: selected, edges: copiedEdges, incomingEdges };
        e.preventDefault();
      }

      if (e.key === 'v') {
        const cb = clipboardRef.current;
        if (!cb || cb.nodes.length === 0) return;
        const ts = Date.now();
        const idMap = new Map<string, string>();

        const newNodes: Node<NodeData>[] = cb.nodes.map((n, i) => {
          const newId = `${n.type}-${ts}-${i}`;
          idMap.set(n.id, newId);
          return { ...n, id: newId, position: { x: n.position.x + 50, y: n.position.y + 50 }, data: pasteCleanData(n.type, n.data), selected: true } as Node<NodeData>;
        });

        // Internal edges — both ends remapped to new IDs
        const internalEdges: Edge[] = cb.edges.map((edge, i) => ({
          ...edge,
          id: `edge-${ts}-${i}`,
          source: idMap.get(edge.source) ?? edge.source,
          target: idMap.get(edge.target) ?? edge.target,
          animated: false,
        }));

        // Incoming edges from non-copied nodes — only the target is remapped so
        // the pasted node stays connected to the same upstream source.
        const externalEdges: Edge[] = (cb.incomingEdges ?? []).map((edge, i) => ({
          ...edge,
          id: `edge-ext-${ts}-${i}`,
          target: idMap.get(edge.target) ?? edge.target,
          animated: false,
        }));

        // Reconstruct connection-derived state for pasted nodes.
        // pasteCleanData intentionally clears derived fields (promptConnected,
        // imagePortCount, inputImageUrls…) but leaves the edges intact, so we
        // mirror the same logic as onConnectHandler to restore them before render.
        const allPastedEdges = [...internalEdges, ...externalEdges];
        for (const edge of allPastedEdges) {
          const tgtIdx = newNodes.findIndex((n) => n.id === edge.target);
          if (tgtIdx === -1) continue;
          const sourceNode = newNodes.find((n) => n.id === edge.source)
            ?? nodesRef.current.find((n) => n.id === edge.source);
          if (!sourceNode) continue;

          // ── Prompt connections ──────────────────────────────────────────
          if (edge.targetHandle === 'prompt') {
            let prompt: string | undefined;
            if (sourceNode.type === 'promptNode') {
              prompt = (sourceNode.data as { prompt?: string }).prompt;
            } else if (sourceNode.type === 'imageToPromptNode') {
              prompt = (sourceNode.data as ImageToPromptNodeData).generatedPrompt ?? undefined;
            }
            newNodes[tgtIdx] = {
              ...newNodes[tgtIdx],
              data: {
                ...newNodes[tgtIdx].data,
                promptConnected: true,
                ...(prompt !== undefined ? { prompt } : {}),
              } as NodeData,
            };
            continue;
          }

          // ── start_frame / end_frame → videoGenNode ─────────────────────
          if (edge.targetHandle === 'start_frame' || edge.targetHandle === 'end_frame') {
            const imageUrl = getNodeMediaUrls(sourceNode, 'image')[0];
            if (imageUrl) {
              const field = edge.targetHandle === 'start_frame' ? 'startFrameUrl' : 'endFrameUrl';
              newNodes[tgtIdx] = {
                ...newNodes[tgtIdx],
                data: { ...newNodes[tgtIdx].data, [field]: imageUrl } as NodeData,
              };
            }
            continue;
          }

          // ── video / video_in → videoUrl on target ──────────────────────
          if (edge.targetHandle === 'video' || edge.targetHandle === 'video_in') {
            const videoUrl = getNodeMediaUrls(sourceNode, 'video')[0];
            if (videoUrl) {
              newNodes[tgtIdx] = {
                ...newNodes[tgtIdx],
                data: { ...newNodes[tgtIdx].data, videoUrl } as NodeData,
              };
            }
            continue;
          }

          // ── Multi-image ref_ connections (imageGenNode) ─────────────────
          if (!edge.targetHandle?.startsWith('ref_')) continue;

          const imageUrl = getNodeMediaUrls(sourceNode, 'image')[0];
          if (!imageUrl) continue;

          const tgtData = newNodes[tgtIdx].data as ImageGenNodeData;
          const urls = [...(tgtData.inputImageUrls ?? [])];
          const refIdx = parseInt(edge.targetHandle.split('_')[1]);
          urls[refIdx] = imageUrl;
          const filled = urls.filter(Boolean).length;
          const maxRefs = getImageReferenceLimit(tgtData.model);
          newNodes[tgtIdx] = {
            ...newNodes[tgtIdx],
            data: { ...newNodes[tgtIdx].data, inputImageUrls: urls, imagePortCount: Math.min(filled + 1, maxRefs) } as NodeData,
          };
        }

        setNodes([...nodesRef.current.map((n) => ({ ...n, selected: false })), ...newNodes]);
        setEdges([...edgesRef.current, ...internalEdges, ...externalEdges]);
        e.preventDefault();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setNodes, setEdges, groupSelectedNodes]);

  // Connection validation — only allow matching port types
  const isValidConnection = useCallback<IsValidConnection<Edge>>(
    (connectionOrEdge) => {
      const conn = connectionOrEdge as Connection;
      const sourceNode = nodes.find((n) => n.id === conn.source);
      const targetNode = nodes.find((n) => n.id === conn.target);
      if (!sourceNode || !targetNode) return false;

      const srcKey = `${sourceNode.type}:${conn.sourceHandle ?? ''}:source`;
      const tgtKey = `${targetNode.type}:${conn.targetHandle ?? ''}:target`;
      const srcType = PORT_TYPE_MAP[srcKey];
      const tgtType = PORT_TYPE_MAP[tgtKey];
      const reject = (message: string) => {
        showConnectionToast({ message, tone: 'error' });
        return false;
      };

      if (targetNode.type === 'galleryOutputNode' && conn.targetHandle === 'input') {
        return srcType === 'image' || srcType === 'video'
          ? true
          : reject('Output Gallery accepts image or video outputs');
      }

      // upscaleMediaNode accepts multiple image or video connections (mode-locked, capped)
      if (targetNode.type === 'upscaleMediaNode' && conn.targetHandle === 'media') {
        if (srcType !== 'image' && srcType !== 'video') {
          return reject('Upscale Media accepts image or video outputs');
        }
        const liveEdges = useFlowStore.getState().edges;
        const liveNodes = useFlowStore.getState().nodes;
        const mediaEdges = liveEdges.filter(
          (e) => e.target === targetNode.id && e.targetHandle === 'media'
        );
        if (mediaEdges.length > 0) {
          // Reject duplicate source
          if (mediaEdges.some((e) => e.source === conn.source && e.sourceHandle === conn.sourceHandle)) {
            return reject('This output is already connected');
          }
          // Mode-lock: all inputs must share the same type
          const firstEdge = mediaEdges[0];
          const lockedSource = liveNodes.find((node) => node.id === firstEdge.source);
          const lockedType = getSourceMediaType(lockedSource, firstEdge.sourceHandle);
          if (lockedType !== srcType) {
            return reject(`Upscale Media is currently locked to ${lockedType ?? 'another media type'} inputs`);
          }
          // Cap: 30 images, 10 videos
          const cap = lockedType === 'video' ? 10 : 30;
          if (mediaEdges.length >= cap) {
            return reject(`Upscale Media has reached its ${cap}-${lockedType} limit`);
          }
        }
        return true;
      }

      if (targetNode.type === 'imageGenNode' && conn.targetHandle?.startsWith('ref_')) {
        const referenceIndex = Number(conn.targetHandle.slice(4));
        const limit = getImageReferenceLimit((targetNode.data as ImageGenNodeData).model);
        if (!Number.isInteger(referenceIndex) || referenceIndex >= limit) {
          return reject(`This model accepts up to ${limit} reference images`);
        }
      }

      // modifyNode's image input accepts image or video (video triggers outpaint mode)
      if (targetNode.type === 'modifyNode' && conn.targetHandle === 'image') {
        if (srcType === 'image' || srcType === 'video') return true;
        return reject('Modify accepts image or video outputs');
      }

      if (!srcType || !tgtType) return true;

      if (srcType !== tgtType) {
        return reject('Incompatible port types — check the connector icons');
      }
      return true;
    },
    [nodes, showConnectionToast]
  );

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const canvasPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      setContextMenu({ x: e.clientX, y: e.clientY, canvasX: canvasPos.x, canvasY: canvasPos.y });
    },
    [screenToFlowPosition]
  );

  function getAutoConnectTargetHandle(sourceHandleId: string | null, targetNodeType: NodeType): string | null {
    if (sourceHandleId === 'prompt') {
      if (targetNodeType === 'imageGenNode' || targetNodeType === 'videoGenNode' || targetNodeType === 'modifyNode') return 'prompt';
    }
    if (sourceHandleId === 'image') {
      if (targetNodeType === 'videoGenNode')      return 'start_frame';
      if (targetNodeType === 'imageGenNode')      return 'ref_0';
      if (targetNodeType === 'upscaleNode')       return 'image';
      if (targetNodeType === 'upscaleMediaNode')  return 'media';
      if (targetNodeType === 'modifyNode')        return 'image';
      if (targetNodeType === 'removeBgNode')      return 'image';
      if (targetNodeType === 'outputNode')        return 'image';
      if (targetNodeType === 'imageToPromptNode') return 'image';
      if (targetNodeType === 'selectNode')        return 'input';
    }
    if (sourceHandleId === 'video') {
      if (targetNodeType === 'outputNode')        return 'video';
      if (targetNodeType === 'videoToGifNode')    return 'video';
      if (targetNodeType === 'videoUpscaleNode')  return 'video_in';
      if (targetNodeType === 'upscaleMediaNode')  return 'media';
      if (targetNodeType === 'modifyNode')        return 'image';
    }
    return null;
  }

  function handleAddNode(type: NodeType, position?: { x: number; y: number }) {
    const pos = position ?? (contextMenu ? { x: contextMenu.canvasX, y: contextMenu.canvasY } : { x: 200, y: 200 });
    const nodeId = `${type}-${Date.now()}`;
    addNode({
      id: nodeId,
      type,
      position: pos,
      data: { ...DEFAULT_NODE_DATA[type] },
      ...(type === 'groupNode' ? { style: { width: 400, height: 300 } } : {}),
    } as Node<NodeData>);

    // Auto-connect if the menu was opened by dragging from a source handle
    const pending = pendingConnectionRef.current;
    if (pending?.nodeId && pending.handleType === 'source') {
      const targetHandle = getAutoConnectTargetHandle(pending.handleId, type);
      if (targetHandle) {
        const connection: Connection = {
          source:       pending.nodeId,
          sourceHandle: pending.handleId,
          target:       nodeId,
          targetHandle,
        };
        // Drag-to-empty node creation remains a single-source action.
        pendingConnectionRef.current = null;
        onConnectHandler(connection);
      }
    }
    pendingConnectionRef.current = null;
  }

  const propagateImageToTarget = useCallback(
    (sourceNodeId: string, targetEdge: Edge, imageUrl: string | null) => {
      // Always read fresh node data to avoid stale React closure issues
      const freshNodes = useFlowStore.getState().nodes;
      const targetNode = freshNodes.find((n) => n.id === targetEdge.target);
      if (!targetNode) return;
      const handle = targetEdge.targetHandle ?? '';

      if (targetNode.type === 'upscaleNode' || targetNode.type === 'modifyNode' || targetNode.type === 'removeBgNode') {
        updateNodeData(targetEdge.target, { inputImageUrl: imageUrl ?? undefined });
      } else if (targetNode.type === 'imageToPromptNode') {
        updateNodeData(targetEdge.target, { inputImageUrl: imageUrl ?? undefined });
      } else if (targetNode.type === 'videoGenNode') {
        if (handle === 'start_frame') updateNodeData(targetEdge.target, { startFrameUrl: imageUrl ?? undefined });
        else if (handle === 'end_frame') updateNodeData(targetEdge.target, { endFrameUrl: imageUrl ?? undefined });
      } else if (targetNode.type === 'imageGenNode') {
        const currentData = targetNode.data as ImageGenNodeData;
        const urls = [...(currentData.inputImageUrls ?? [])];
        if (handle.startsWith('ref_')) {
          const idx = parseInt(handle.split('_')[1]);
          urls[idx] = imageUrl ?? '';
        } else {
          urls[0] = imageUrl ?? '';
        }
        const maxRefs = getImageReferenceLimit(currentData.model);
        const referenceIndexes = useFlowStore.getState().edges
          .filter((edge) =>
            edge.id !== targetEdge.id &&
            edge.target === targetEdge.target &&
            edge.targetHandle?.startsWith('ref_')
          )
          .map((edge) => Number(edge.targetHandle?.slice(4)))
          .filter(Number.isInteger);
        const highestOccupied = referenceIndexes.length > 0 ? Math.max(...referenceIndexes) : -1;
        updateNodeData(targetEdge.target, {
          inputImageUrls: urls,
          imagePortCount: Math.min(Math.max(highestOccupied + 2, 1), maxRefs),
        });
      }
    },
    [updateNodeData]
  );

  useEffect(() => {
    function handleImagePropagate(e: Event) {
      const { sourceNodeId, imageUrl } = (e as CustomEvent).detail as { sourceNodeId: string; imageUrl: string | null };
      const sourceNode = nodes.find((node) => node.id === sourceNodeId);
      const connectedEdges = edges.filter(
        (edge) => edge.source === sourceNodeId && getSourceMediaType(sourceNode, edge.sourceHandle) === 'image'
      );
      for (const edge of connectedEdges) {
        propagateImageToTarget(sourceNodeId, edge, imageUrl);
      }
    }
    document.addEventListener('node:image-propagate', handleImagePropagate);
    return () => document.removeEventListener('node:image-propagate', handleImagePropagate);
  }, [edges, nodes, propagateImageToTarget]);

  useEffect(() => {
    function handleVideoPropagate(e: Event) {
      const { sourceNodeId, videoUrl } = (e as CustomEvent).detail as { sourceNodeId: string; videoUrl: string };
      const connectedEdges = edges.filter((edge) => edge.source === sourceNodeId && edge.sourceHandle === 'video');
      for (const edge of connectedEdges) {
        if (edge.targetHandle === 'video' || edge.targetHandle === 'video_in') {
          updateNodeData(edge.target, { videoUrl });
        }
      }
    }
    document.addEventListener('node:video-propagate', handleVideoPropagate);
    return () => document.removeEventListener('node:video-propagate', handleVideoPropagate);
  }, [edges, updateNodeData]);

  // Remove edges from a specific source handle (fired by MediaInputNode when switching media type).
  useEffect(() => {
    function handleRemoveSourceEdges(e: Event) {
      const { nodeId, handleId } = (e as CustomEvent).detail as { nodeId: string; handleId: string };
      const freshEdges = useFlowStore.getState().edges;
      const toRemove = freshEdges.filter((edge) => edge.source === nodeId && edge.sourceHandle === handleId);
      if (toRemove.length === 0) return;
      for (const edge of toRemove) {
        if (handleId === 'image') propagateImageToTarget(nodeId, edge, null);
        if (handleId === 'video' && (edge.targetHandle === 'video' || edge.targetHandle === 'video_in')) {
          updateNodeData(edge.target, { videoUrl: undefined });
        }
      }
      const removeIds = new Set(toRemove.map((edge) => edge.id));
      useFlowStore.getState().setEdges(freshEdges.filter((e) => !removeIds.has(e.id)));
    }
    document.addEventListener('node:remove-source-edges', handleRemoveSourceEdges);
    return () => document.removeEventListener('node:remove-source-edges', handleRemoveSourceEdges);
  }, [propagateImageToTarget, updateNodeData]);

  const connectSingle = useCallback(
    (connection: Connection) => {
      // ── Single-connection enforcement ────────────────────────────────
      // All target handles accept at most one incoming edge, except galleryOutputNode.
      const freshNodes = useFlowStore.getState().nodes;
      const freshEdges = useFlowStore.getState().edges;
      const targetNode = freshNodes.find((n) => n.id === connection.target);

      // galleryOutputNode and upscaleMediaNode both accept multiple incoming edges.
      if (targetNode?.type !== 'galleryOutputNode' && targetNode?.type !== 'upscaleMediaNode') {
        const existing = freshEdges.filter(
          (e) => e.target === connection.target && e.targetHandle === connection.targetHandle
        );
        if (existing.length > 0) {
          for (const edge of existing) {
            const edgeSource = freshNodes.find((node) => node.id === edge.source);
            if (getSourceMediaType(edgeSource, edge.sourceHandle) === 'image') {
              propagateImageToTarget(edge.source, edge, null);
            }
            if (edge.sourceHandle === 'prompt') updateNodeData(edge.target, { promptConnected: false });
          }
          const removedIds = new Set(existing.map((e) => e.id));
          useFlowStore.getState().setEdges(freshEdges.filter((e) => !removedIds.has(e.id)));
        }
      }

      // Add the new edge (reads fresh edges from store after the setEdges above)
      onConnect(connection);

      // ── Post-connect propagation ─────────────────────────────────────
      if (connection.sourceHandle === 'prompt') {
        const sourceNode = useFlowStore.getState().nodes.find((n) => n.id === connection.source);
        if (sourceNode?.type === 'promptNode') {
          const { prompt } = sourceNode.data as { prompt?: string };
          updateNodeData(connection.target, { prompt: prompt ?? '', promptConnected: true });
        } else if (sourceNode?.type === 'imageToPromptNode') {
          const { generatedPrompt } = sourceNode.data as ImageToPromptNodeData;
          updateNodeData(connection.target, { prompt: generatedPrompt ?? '', promptConnected: true });
        }
      }

      const latestNodes = useFlowStore.getState().nodes;
      const sourceNode = latestNodes.find((n) => n.id === connection.source);
      const sourceMediaType = getSourceMediaType(sourceNode, connection.sourceHandle);

      if (sourceNode && sourceMediaType === 'image') {
        const imageUrl = getNodeMediaUrls(sourceNode, 'image')[0];
        if (imageUrl) {
          propagateImageToTarget(connection.source, {
            id: '', source: connection.source, target: connection.target,
            sourceHandle: connection.sourceHandle, targetHandle: connection.targetHandle,
          }, imageUrl);
        }
      }

      if (sourceNode && sourceMediaType === 'video' && (connection.targetHandle === 'video' || connection.targetHandle === 'video_in')) {
        const videoUrl = getNodeMediaUrls(sourceNode, 'video')[0];
        if (videoUrl) updateNodeData(connection.target, { videoUrl });
      }
    },
    [onConnect, updateNodeData, propagateImageToTarget]
  );

  const onConnectHandler = useCallback(
    (connection: Connection) => {
      const pending = pendingConnectionRef.current;
      const selectedNodeIds = pending?.nodeId === connection.source
        ? pending.selectedNodeIds
        : [];
      if (selectedNodeIds.length <= 1) {
        connectSingle(connection);
        return;
      }

      const freshNodes = useFlowStore.getState().nodes;
      const freshEdges = useFlowStore.getState().edges;
      const sourceNode = freshNodes.find((node) => node.id === connection.source);
      const targetNode = freshNodes.find((node) => node.id === connection.target);
      const draggedMediaType = getSourceMediaType(sourceNode, connection.sourceHandle);
      const isGallery = targetNode?.type === 'galleryOutputNode' && connection.targetHandle === 'input';
      const isUpscaleMedia = targetNode?.type === 'upscaleMediaNode' && connection.targetHandle === 'media';
      const isImageGeneration = targetNode?.type === 'imageGenNode' && connection.targetHandle?.startsWith('ref_');

      if (!sourceNode || !targetNode || !draggedMediaType || (!isGallery && !isUpscaleMedia && !isImageGeneration)) {
        connectSingle(connection);
        return;
      }

      const orderedNodes = [
        sourceNode,
        ...selectedNodeIds
          .filter((nodeId) => nodeId !== sourceNode.id)
          .map((nodeId) => freshNodes.find((node) => node.id === nodeId))
          .filter((node): node is Node<NodeData> => !!node),
      ];
      const skipped = { incompatible: 0, duplicate: 0, limit: 0 };
      const sources: Array<{ node: Node<NodeData>; handle: string }> = [];

      for (const node of orderedNodes) {
        if (node.id === targetNode.id && node.id !== sourceNode.id) {
          skipped.incompatible += 1;
          continue;
        }
        const handle = node.id === sourceNode.id
          ? connection.sourceHandle
          : getActiveMediaSourceHandle(node, draggedMediaType, freshNodes, freshEdges);
        if (!handle || getSourceMediaType(node, handle) !== draggedMediaType) {
          skipped.incompatible += 1;
          continue;
        }
        sources.push({ node, handle });
      }

      const plannedConnections: Connection[] = [];

      if (isGallery || isUpscaleMedia) {
        const targetHandle = connection.targetHandle;
        const existingTargetEdges = freshEdges.filter(
          (edge) => edge.target === targetNode.id && edge.targetHandle === targetHandle
        );
        const existingSourceKeys = new Set(
          existingTargetEdges.map((edge) => `${edge.source}:${edge.sourceHandle ?? ''}`)
        );
        const plannedSourceKeys = new Set<string>();
        const capacity = isUpscaleMedia
          ? (draggedMediaType === 'video' ? 10 : 30) - existingTargetEdges.length
          : Number.POSITIVE_INFINITY;

        for (const source of sources) {
          const key = `${source.node.id}:${source.handle}`;
          if (existingSourceKeys.has(key) || plannedSourceKeys.has(key)) {
            skipped.duplicate += 1;
            continue;
          }
          if (plannedConnections.length >= capacity) {
            skipped.limit += 1;
            continue;
          }
          plannedSourceKeys.add(key);
          plannedConnections.push({
            source: source.node.id,
            sourceHandle: source.handle,
            target: targetNode.id,
            targetHandle,
          });
        }
      } else {
        const targetData = targetNode.data as ImageGenNodeData;
        const limit = getImageReferenceLimit(targetData.model);
        const primaryHandle = connection.targetHandle as string;
        const existingRefEdges = freshEdges.filter(
          (edge) => edge.target === targetNode.id && edge.targetHandle?.startsWith('ref_')
        );
        const occupiedHandles = new Set(
          existingRefEdges
            .map((edge) => edge.targetHandle as string)
            .filter((handle) => handle !== primaryHandle)
        );
        const existingSources = new Set(
          existingRefEdges
            .filter((edge) => edge.targetHandle !== primaryHandle)
            .map((edge) => `${edge.source}:${edge.sourceHandle ?? ''}`)
        );
        const freeHandles = Array.from({ length: limit }, (_, index) => `ref_${index}`)
          .filter((handle) => handle !== primaryHandle && !occupiedHandles.has(handle));

        sources.forEach((source, index) => {
          const sourceKey = `${source.node.id}:${source.handle}`;
          if (index > 0 && existingSources.has(sourceKey)) {
            skipped.duplicate += 1;
            return;
          }
          const targetHandle = index === 0 ? primaryHandle : freeHandles.shift();
          if (!targetHandle) {
            skipped.limit += 1;
            return;
          }
          existingSources.add(sourceKey);
          plannedConnections.push({
            source: source.node.id,
            sourceHandle: source.handle,
            target: targetNode.id,
            targetHandle,
          });
        });
      }

      for (const plannedConnection of plannedConnections) {
        connectSingle(plannedConnection);
      }

      if (isImageGeneration) {
        const finalRefIndexes = useFlowStore.getState().edges
          .filter((edge) => edge.target === targetNode.id && edge.targetHandle?.startsWith('ref_'))
          .map((edge) => Number(edge.targetHandle?.slice(4)))
          .filter(Number.isInteger);
        const limit = getImageReferenceLimit((targetNode.data as ImageGenNodeData).model);
        const highestOccupied = finalRefIndexes.length > 0 ? Math.max(...finalRefIndexes) : -1;
        updateNodeData(targetNode.id, {
          imagePortCount: Math.min(Math.max(highestOccupied + 2, 1), limit),
        });
      }

      const skippedTotal = skipped.incompatible + skipped.duplicate + skipped.limit;
      const reasons = [
        skipped.incompatible > 0 ? `${skipped.incompatible} incompatible` : null,
        skipped.duplicate > 0 ? `${skipped.duplicate} already connected` : null,
        skipped.limit > 0 ? `${skipped.limit} over limit` : null,
      ].filter(Boolean).join(', ');
      showConnectionToast({
        message: skippedTotal > 0
          ? `Connected ${plannedConnections.length} node${plannedConnections.length === 1 ? '' : 's'} · Skipped ${skippedTotal} (${reasons})`
          : `Connected ${plannedConnections.length} nodes`,
        tone: skippedTotal > 0 ? 'partial' : 'success',
      });
    },
    [connectSingle, showConnectionToast, updateNodeData]
  );

  const onEdgesChangeHandler = useCallback(
    (changes: EdgeChange[]) => {
      for (const change of changes) {
        if (change.type !== 'remove') continue;
        const edge = edges.find((e) => e.id === change.id);
        if (!edge) continue;
        const sourceNode = nodes.find((node) => node.id === edge.source);
        const sourceMediaType = getSourceMediaType(sourceNode, edge.sourceHandle);
        if (sourceMediaType === 'image') {
          propagateImageToTarget(edge.source, edge, null);
        }
        if (sourceMediaType === 'video' && (edge.targetHandle === 'video' || edge.targetHandle === 'video_in')) {
          updateNodeData(edge.target, { videoUrl: undefined });
        }
        if (edge.sourceHandle === 'prompt') {
          // Check if the target still has another prompt edge after this removal
          const remaining = edges.filter((e) => e.id !== edge.id && e.target === edge.target && e.sourceHandle === 'prompt');
          if (remaining.length === 0) {
            updateNodeData(edge.target, { promptConnected: false });
          }
        }
      }
      onEdgesChange(changes);
    },
    [edges, nodes, onEdgesChange, propagateImageToTarget, updateNodeData]
  );

  const onConnectStart: OnConnectStart = useCallback((_, params) => {
    const nodeId = params.nodeId ?? '';
    const selectedNodes = nodesRef.current.filter(
      (node) => node.selected && node.type !== 'groupNode'
    );
    const selectedNodeIds = selectedNodes.some((node) => node.id === nodeId)
      ? selectedNodes.map((node) => node.id)
      : [nodeId];
    pendingConnectionRef.current = {
      nodeId,
      handleId:   params.handleId   ?? null,
      handleType: params.handleType ?? null,
      selectedNodeIds,
    };
  }, []);

  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
    // Only open menu when the drag ends without connecting to a valid target
    if (connectionState.isValid === true) {
      pendingConnectionRef.current = null;
      return;
    }
    if (connectionState.toHandle) {
      pendingConnectionRef.current = null;
      return;
    }
    const pending = pendingConnectionRef.current;
    if (!pending?.nodeId) return;

    const e = event as MouseEvent;
    const canvasPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    setContextMenu({ x: e.clientX, y: e.clientY, canvasX: canvasPos.x, canvasY: canvasPos.y });
  }, [screenToFlowPosition]);

  function onDragOver(e: React.DragEvent) {
    const hasMediaFile = Array.from(e.dataTransfer.items).some(
      (item) => item.kind === 'file' && (item.type.startsWith('image/') || item.type.startsWith('video/'))
    );
    if (!hasMediaFile) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);
  }

  function onDragLeave(e: React.DragEvent) {
    if (!reactFlowWrapper.current?.contains(e.relatedTarget as globalThis.Node | null)) {
      setIsDragOver(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files).filter(
      (f) => f.type.startsWith('image/') || f.type.startsWith('video/')
    );
    if (files.length === 0) return;

    const canvasPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });

    files.forEach((file, i) => {
      const position = { x: canvasPos.x + i * 280, y: canvasPos.y };
      const nodeId = `mediaInputNode-${Date.now()}-${i}`;

      // Create the node immediately so the user sees the processing state right away.
      addNode({
        id: nodeId,
        type: 'mediaInputNode',
        position,
        data: { uploadStatus: 'validating' } as MediaInputNodeData,
      } as Node<NodeData>);

      function setStatus(updates: Partial<MediaInputNodeData>) {
        document.dispatchEvent(new CustomEvent('node:update', { detail: { nodeId, data: updates } }));
      }

      if (file.type.startsWith('image/')) {
        (async () => {
          let processed: File;
          try {
            processed = await processImageFile(file, (stage, percent) => {
              if (stage === 'compressing') {
                setStatus({ uploadStatus: 'compressing', uploadProgress: percent ?? 0 });
              } else {
                setStatus({ uploadStatus: stage });
              }
            });
          } catch (err) {
            setStatus({
              uploadStatus: 'error',
              uploadError: err instanceof Error ? err.message : 'Failed to process image.',
              uploadProgress: undefined,
            });
            return;
          }
          setStatus({ uploadStatus: 'uploading', uploadProgress: undefined });
          try {
            const url = await uploadImageToStorage(processed);
            setStatus({ mediaType: 'image', imageUrl: url, uploadStatus: undefined, uploadProgress: undefined, uploadError: undefined });
            document.dispatchEvent(new CustomEvent('node:image-propagate', {
              detail: { sourceNodeId: nodeId, imageUrl: url },
            }));
          } catch (err) {
            setStatus({
              uploadStatus: 'error',
              uploadError: err instanceof Error ? err.message : 'Upload failed.',
              uploadProgress: undefined,
            });
          }
        })();
      } else {
        // Video — store in the module-level map so MediaInputNode can consume
        // it on mount (dispatching an event here would race against mount).
        setStatus({ uploadStatus: undefined });
        setPendingFile(nodeId, file);
      }
    });
  }

  const selectedCount = nodes.filter((n) => n.selected && n.type !== 'groupNode').length;

  return (
    <div
      ref={reactFlowWrapper}
      className="w-full h-full relative"
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {isDragOver && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none"
          style={{ background: 'rgba(59,158,255,0.08)', border: '2px dashed var(--color-accent)' }}
        >
          <p className="text-sm font-medium" style={{ color: 'var(--color-accent)' }}>
            Drop image to create an Image Input node
          </p>
        </div>
      )}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={readOnly ? undefined : onNodesChange}
        onEdgesChange={readOnly ? undefined : onEdgesChangeHandler}
        onConnect={readOnly ? undefined : onConnectHandler}
        onConnectStart={readOnly ? undefined : onConnectStart}
        onConnectEnd={readOnly ? undefined : onConnectEnd}
        isValidConnection={isValidConnection}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ animated: false, type: 'default' }}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        onInit={(instance) => {
          // fitView is applied during initialization; this fallback also
          // covers canvases where no camera gesture emits onMoveEnd.
          zoomInitTimer.current = setTimeout(() => {
            if (
              !cameraGestureActive.current
              && useMediaLodStore.getState().settledZoom === null
            ) {
              settleZoom(instance.getViewport().zoom);
            }
          }, 200);
        }}
        onMoveStart={handleMoveStart}
        onMoveEnd={(_, viewport) => handleMoveEnd(viewport.zoom)}
        minZoom={0.1}
        maxZoom={2}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        elementsSelectable={!readOnly}
        deleteKeyCode={readOnly ? null : 'Delete'}
        multiSelectionKeyCode="Shift"
        selectionKeyCode="Shift"
        style={{ background: 'var(--color-bg-darkest)' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={28} size={1.5} color={theme === 'light' ? '#29292A' : 'rgba(255,255,255,0.18)'} />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor="var(--color-bg-surface)"
          maskColor="rgba(0,0,0,0.4)"
          style={{ background: 'var(--color-bg-elevated)', border: 'var(--border-default)' }}
        />
        <Panel position="bottom-center">
          <p className="text-xs" style={{ color: 'var(--color-white-muted)' }}>
            Right-click to add nodes · Shift+click or drag to multi-select · Ctrl+G to group · Delete removes selected
          </p>
        </Panel>
      </ReactFlow>

      <ConnectionToast toast={connectionToast} />

      {contextMenu && (
        <NodeToolbar
          x={contextMenu.x}
          y={contextMenu.y}
          onAdd={(type) => handleAddNode(type)}
          onClose={() => setContextMenu(null)}
          selectedCount={selectedCount}
          onGroup={groupSelectedNodes}
          allowedTypes={allowedTypes}
        />
      )}
    </div>
  );
}
