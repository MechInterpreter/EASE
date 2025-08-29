/**
 * Service for automated supernode reconstruction API calls
 */

export interface ReconstructionConfig {
  tau_sim: number;     // Minimum cosine similarity for candidate merges
  alpha: number;       // Minimum mean correlation for fidelity gate
  beta: number;        // Maximum cross-entropy gap for fidelity gate
  intra_layer_only: boolean; // Only merge within layers
}

export interface ReconstructionStats {
  original_nodes: number;
  final_nodes: number;
  compression_ratio: number;
  num_supernodes: number;
  candidates_proposed: number;
  candidates_passed_gate: number;
}

export interface SupernodeReconstructionResult {
  supernodes: Array<{
    id: string;
    members: string[];
    layer: string;
    size: number;
    mean_influence: number;
  }>;
  rewired_graph: any;
  merge_log: Array<{
    node1: string;
    node2: string;
    similarity: number;
    layer: string;
  }>;
  stats: ReconstructionStats;
}

// Detect local dev to target backend on :8000. Support localhost and 127.0.0.1
const API_BASE = (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'))
  ? 'http://localhost:8000'
  : '';

class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

// Races a promise against a timeout. On timeout, invokes onTimeout (e.g., controller.abort()).
async function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => void, label: string): Promise<T> {
  let timer: any;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try { onTimeout(); } catch {}
      reject(new TimeoutError(`${label} timed out after ${ms} ms`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export class SupernodeService {
  
  static async getDefaultConfig(timeoutMs: number = 20000): Promise<ReconstructionConfig> {
    const controller = new AbortController();
    const response = await withTimeout(fetch(`${API_BASE}/api/supernodes/config/defaults`, {
      signal: controller.signal,
    }), timeoutMs, () => controller.abort(), 'Get default config');
    if (!response.ok) {
      throw new Error(`Failed to get default config: ${response.status} ${response.statusText}`);
    }
    return withTimeout(response.json(), Math.max(3000, Math.floor(timeoutMs * 0.5)), () => controller.abort(), 'Parsing default config JSON');
  }

  static async getCharlottePresetConfig(timeoutMs: number = 20000): Promise<ReconstructionConfig> {
    const controller = new AbortController();
    const response = await withTimeout(fetch(`${API_BASE}/api/supernodes/config/preset/charlotte`, {
      signal: controller.signal,
    }), timeoutMs, () => controller.abort(), 'Get Charlotte preset config');
    if (!response.ok) {
      throw new Error(`Failed to get Charlotte preset config: ${response.status} ${response.statusText}`);
    }
    return withTimeout(response.json(), Math.max(3000, Math.floor(timeoutMs * 0.5)), () => controller.abort(), 'Parsing Charlotte preset config JSON');
  }

  static async reconstructSupernodes(
    attributionGraph: any, 
    config?: Partial<ReconstructionConfig>,
    timeoutMs: number = 120000
  ): Promise<SupernodeReconstructionResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const start = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    console.log('[SupernodeService] reconstructSupernodes → POST', `${API_BASE}/api/supernodes/reconstruct`, {
      timeoutMs,
      apiBase: API_BASE || '(relative)',
    });

    try {
      const response = await withTimeout(fetch(`${API_BASE}/api/supernodes/reconstruct`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          attribution_graph: attributionGraph,
          config: config || {}
        }),
        signal: controller.signal,
      }), timeoutMs, () => controller.abort(), 'Supernode reconstruction request');

      const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - start;
      console.log('[SupernodeService] reconstructSupernodes ← response', { ok: response.ok, status: response.status, elapsedMs: Math.round(elapsed) });

      if (!response.ok) {
        throw new Error(`Supernode reconstruction failed: ${response.status} ${response.statusText}`);
      }

      const parseStart = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const json = await withTimeout(response.json(), Math.max(5000, Math.floor(timeoutMs * 0.75)), () => controller.abort(), 'Parsing reconstruction JSON');
      const parseElapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - parseStart;
      if (parseElapsed > 2000) {
        console.log('[SupernodeService] reconstructSupernodes JSON parse slow', { parseMs: Math.round(parseElapsed) });
      }
      return json;
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw new Error(`Supernode reconstruction request timed out after ${timeoutMs} ms`);
      }
      if (err?.name === 'TimeoutError') {
        throw new Error(err.message);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  static async reconstructCharlotteSupernodes(
    config?: Partial<ReconstructionConfig>,
    timeoutMs: number = 120000
  ): Promise<SupernodeReconstructionResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const start = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    console.log('[SupernodeService] reconstructCharlotteSupernodes → POST', `${API_BASE}/api/supernodes/reconstruct-charlotte`, { timeoutMs });

    try {
      const response = await withTimeout(fetch(`${API_BASE}/api/supernodes/reconstruct-charlotte`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config || {}),
        signal: controller.signal,
      }), timeoutMs, () => controller.abort(), 'Charlotte reconstruction request');

      const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - start;
      console.log('[SupernodeService] reconstructCharlotteSupernodes ← response', { ok: response.ok, status: response.status, elapsedMs: Math.round(elapsed) });

      if (!response.ok) {
        throw new Error(`Charlotte supernode reconstruction failed: ${response.status} ${response.statusText}`);
      }

      const parseStart = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const json = await withTimeout(response.json(), Math.max(5000, Math.floor(timeoutMs * 0.75)), () => controller.abort(), 'Parsing Charlotte reconstruction JSON');
      const parseElapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - parseStart;
      if (parseElapsed > 2000) {
        console.log('[SupernodeService] reconstructCharlotteSupernodes JSON parse slow', { parseMs: Math.round(parseElapsed) });
      }
      return json;
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw new Error(`Charlotte reconstruction request timed out after ${timeoutMs} ms`);
      }
      if (err?.name === 'TimeoutError') {
        throw new Error(err.message);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  static async getCharlotteData(timeoutMs: number = 20000): Promise<any> {
    const controller = new AbortController();
    const response = await withTimeout(fetch(`${API_BASE}/api/supernodes/charlotte-data`, {
      signal: controller.signal,
    }), timeoutMs, () => controller.abort(), 'Get Charlotte data');
    if (!response.ok) {
      throw new Error(`Failed to load Charlotte data: ${response.status} ${response.statusText}`);
    }
    return withTimeout(response.json(), Math.max(3000, Math.floor(timeoutMs * 0.5)), () => controller.abort(), 'Parsing Charlotte data JSON');
  }

  /**
   * Convert backend supernode result to frontend SupernodeData format
   */
  static convertToSupernodeData(result: SupernodeReconstructionResult): {
    nodes: Array<{
      id: string;
      size: number;
      layer?: number;
      members: string[];
    }>;
    edges: Array<{
      source: string;
      target: string;
      weight: number;
    }>;
  } {
    const nodes = result.supernodes.map(supernode => ({
      id: supernode.id,
      size: supernode.size,
      layer: parseInt(supernode.layer) || 0,
      members: supernode.members
    }));

    // Normalize edges from rewired_graph to ensure string IDs and numeric weight
    const rawEdges = Array.isArray(result.rewired_graph?.edges) ? result.rewired_graph.edges : [];
    const normalized = rawEdges.map((e: any) => {
      const s = typeof e.source === 'string' ? e.source : (e.source?.id ?? String(e.source ?? ''));
      const t = typeof e.target === 'string' ? e.target : (e.target?.id ?? String(e.target ?? ''));
      const w = typeof e.weight === 'number' ? e.weight : Number(e.weight ?? 0.1);
      return (s && t) ? { source: s, target: t, weight: isFinite(w) ? w : 0.1 } : null;
    }).filter((e: any) => e !== null) as Array<{ source: string; target: string; weight: number }>;

    console.log('[SupernodeService] convertToSupernodeData', {
      nodeCount: nodes.length,
      inputEdgeCount: rawEdges.length,
      normalizedEdgeCount: normalized.length,
    });

    // If no edges in rewired graph, create simple connections between supernodes in adjacent layers
    if (normalized.length === 0 && nodes.length > 1) {
      const edgeList: Array<{source: string; target: string; weight: number}> = [];
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const node1 = nodes[i];
          const node2 = nodes[j];
          const layerDiff = Math.abs((node1.layer || 0) - (node2.layer || 0));
          if (layerDiff <= 1) {
            edgeList.push({
              source: node1.id,
              target: node2.id,
              weight: layerDiff === 0 ? 0.3 : 0.6,
            });
          }
        }
      }
      return { nodes, edges: edgeList };
    }

    return { nodes, edges: normalized };
  }
}
