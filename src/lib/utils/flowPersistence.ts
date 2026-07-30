/**
 * Media uploads and all other meaningful canvas content are owned by nodes, so
 * the first node covers every activation condition.
 */
export function shouldActivateFlow(nodes: readonly unknown[]): boolean {
  return nodes.length >= 1;
}

export function shouldDiscardAbandonedFlow(nodes: readonly unknown[]): boolean {
  return !shouldActivateFlow(nodes);
}
