/**
 * Label resolver service for graph nodes
 */

import type { GraphNode } from '../../lib/graph-types';
import type { LabelMode } from './autoInterp';

export class LabelResolver {
  private labelCache = new Map<string, string>();

  async preloadTopNodeLabels(nodes: GraphNode[], labelMode: LabelMode, count: number): Promise<void> {
    // Sort nodes by influence and take top N
    const topNodes = nodes
      .filter(node => node.influence !== undefined)
      .sort((a, b) => (b.influence || 0) - (a.influence || 0))
      .slice(0, count);

    for (const node of topNodes) {
      const label = this.getNodeLabel(node, labelMode);
      this.labelCache.set(node.id, label);
    }
  }

  getNodeLabel(node: GraphNode, labelMode: LabelMode): string {
    const cached = this.labelCache.get(node.id);
    if (cached) return cached;

    switch (labelMode) {
      case 'clerp':
        return node.clerp || node.ppClerp || `Feature ${node.id}`;
      case 'autointerp':
        // Fallback to clerp for now - in real implementation would call auto-interp API
        return node.clerp || node.ppClerp || `Feature ${node.id}`;
      case 'manual':
        return `Feature ${node.id}`;
      default:
        return `Feature ${node.id}`;
    }
  }

  getDisplayLabel(node: GraphNode, labelMode: LabelMode): string {
    return this.getNodeLabel(node, labelMode);
  }

  exportLabels(): Record<string, string> {
    return Object.fromEntries(this.labelCache);
  }

  importLabels(labels: Record<string, string>): void {
    for (const [nodeId, label] of Object.entries(labels)) {
      this.labelCache.set(nodeId, label);
    }
  }
}

export const labelResolver = new LabelResolver();
