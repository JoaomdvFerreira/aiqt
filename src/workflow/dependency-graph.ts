export interface DependencyEdge {
  from: string;
  to: string;
}

/** Minimal shape needed from a canonical Dependency record for relatedness queries -- avoids importing the full schema type into this low-level module. */
export interface DependencyRelationEdge {
  id: string;
  fromId: string;
  toId: string;
  type: "blocks" | "requires" | "relates_to";
}

export interface DependencyRelation {
  direct: boolean;
  transitive: boolean;
  /** IDs of the direct blocking/requires edge(s) between the two work units, in either direction. Empty when `direct` is false. */
  relatedDependencyIds: string[];
}

/**
 * M24 §8.3 (Gate D finding: no existing transitive-dependency-query owner):
 * determines whether two work units are directly or transitively related
 * through `blocks`/`requires` edges, in either direction -- conflict
 * purposes are direction-agnostic ("either directly depends on the
 * other"), unlike readiness satisfaction which is direction-sensitive.
 * `relates_to` edges are never inspected, matching the existing
 * readiness engine's convention (effective-readiness.ts). This is a
 * minimal, additive extension of this same graph-owning module -- never
 * reimplemented elsewhere.
 */
export function evaluateDependencyRelation(
  leftWorkUnitId: string,
  rightWorkUnitId: string,
  dependencies: readonly DependencyRelationEdge[],
): DependencyRelation {
  const blockingEdges = dependencies.filter((d) => d.type === "blocks" || d.type === "requires");

  const directEdges = blockingEdges.filter(
    (d) =>
      (d.fromId === leftWorkUnitId && d.toId === rightWorkUnitId) ||
      (d.fromId === rightWorkUnitId && d.toId === leftWorkUnitId),
  );
  if (directEdges.length > 0) {
    return {
      direct: true,
      transitive: false,
      relatedDependencyIds: [...new Set(directEdges.map((d) => d.id))].sort(),
    };
  }

  const adjacency = new Map<string, Set<string>>();
  for (const edge of blockingEdges) {
    if (!adjacency.has(edge.fromId)) adjacency.set(edge.fromId, new Set());
    if (!adjacency.has(edge.toId)) adjacency.set(edge.toId, new Set());
    adjacency.get(edge.fromId)!.add(edge.toId);
    adjacency.get(edge.toId)!.add(edge.fromId);
  }

  const visited = new Set<string>([leftWorkUnitId]);
  const queue: string[] = [leftWorkUnitId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const neighbor of adjacency.get(current) ?? []) {
      if (neighbor === rightWorkUnitId) {
        return { direct: false, transitive: true, relatedDependencyIds: [] };
      }
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return { direct: false, transitive: false, relatedDependencyIds: [] };
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
