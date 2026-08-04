import { create } from 'zustand';

interface MediaLodStore {
  /** Null until React Flow has completed its initial fit-view. */
  settledZoom: number | null;
  cameraMoving: boolean;
  beginCameraMove: () => void;
  settleCamera: (zoom: number) => void;
  resetCamera: () => void;
}

export const useMediaLodStore = create<MediaLodStore>((set) => ({
  settledZoom: null,
  cameraMoving: true,
  beginCameraMove: () => set({ cameraMoving: true }),
  settleCamera: (settledZoom) => set({ settledZoom, cameraMoving: false }),
  resetCamera: () => set({ settledZoom: null, cameraMoving: true }),
}));
