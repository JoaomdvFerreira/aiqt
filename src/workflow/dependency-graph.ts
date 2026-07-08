export interface DependencyEdge {
  from: string;
  to: string;
}

/**
 * Detect a cycle in a directed graph over the given node ids and edges.
 * Uses DFS with a visiting/done coloring so it also reports the cycle path
 * for a clear error message. Returns null if the graph is acyclic.
 */
export function findCycle(
  nodes: readonly string[],
  edges: readonly DependencyEdge[],
): string[] | null {
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node, []);
  for (const edge of edges) {
    adjacency.get(edge.from)?.push(edge.to);
  }

  const state = new Map<string, "visiting" | "done">();
  const pathStack: string[] = [];

  function visit(node: string): string[] | null {
    state.set(node, "visiting");
    pathStack.push(node);
    for (const neighbor of adjacency.get(node) ?? []) {
      const neighborState = state.get(neighbor);
      if (neighborState === "visiting") {
        const cycleStart = pathStack.indexOf(neighbor);
        return [...pathStack.slice(cycleStart), neighbor];
      }
      if (neighborState !== "done") {
        const found = visit(neighbor);
        if (found) return found;
      }
    }
    pathStack.pop();
    state.set(node, "done");
    return null;
  }

  for (const node of nodes) {
    if (!state.has(node)) {
      const found = visit(node);
      if (found) return found;
    }
  }
  return null;
}
