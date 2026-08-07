// Module-level map used to hand a dropped File from FlowCanvas to a
// MediaInputNode before its useEffect listeners are registered.
// FlowCanvas writes with setPendingFile; MediaInputNode reads with
// consumePendingFile on mount. The entry is deleted on first read.

const pendingFiles = new Map<string, File>();

export function setPendingFile(nodeId: string, file: File): void {
  pendingFiles.set(nodeId, file);
}

export function consumePendingFile(nodeId: string): File | undefined {
  const file = pendingFiles.get(nodeId);
  if (file) pendingFiles.delete(nodeId);
  return file;
}
