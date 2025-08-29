// Supernode Cluster View - Force layout with expand/collapse and member inspection
import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react'
import * as d3 from 'd3'
import { Selection, BaseType, SimulationNodeDatum, SimulationLinkDatum } from 'd3'
import type { GraphNode, GraphLink } from '../lib/graph-types'

type SupernodeData = GraphNode & {
  members?: GraphNode[]
  expanded?: boolean
  x?: number
  y?: number
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
}

type ForceNode = SupernodeData & SimulationNodeDatum
type ForceLink = SimulationLinkDatum<ForceNode> & { weight?: number; value?: number }

// Color palette for different layers
const getLayerColor = (layer: number): string => {
  const colors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
    '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'
  ]
  return colors[layer % colors.length]
}

// Deterministic hash → [0,1) for stable seeded placement
const hashToUnit = (s: string): number => {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

interface SupernodeClusterViewProps {
  data: {
    nodes: any[]
    links?: any[]
    edges?: any[]
    allNodes?: Array<{ id: string; layer: number } | string>
  }
  onNodeHover?: (node: GraphNode | null) => void
  onNodeClick?: (node: GraphNode | null) => void
  onNeighborhoodIsolate?: (node: GraphNode, hops: number) => void
  edgeOpacityThreshold?: number
  neighborsN?: number
  showLabels?: boolean
  darkMode?: boolean
  layout?: 'force' | 'layered'
  onNodeDoubleClick?: (nodeId: string) => void
  onEdgeClick?: (source: string, target: string) => void
  selectedNodes?: string[]
  pinnedNodes?: string[]
  highlightedPath?: string[]
  isolatedNodes?: string[]
  setIsolatedNeighborhood?: (nodes: Set<string>) => void
  isReconstructing?: boolean
}

function SupernodeClusterView({
  data,
  onNodeHover,
  onNodeClick,
  onNeighborhoodIsolate,
  edgeOpacityThreshold = 0.1,
  neighborsN = 5,
  showLabels = true,
  darkMode = false,
  layout = 'force',
  onNodeDoubleClick,
  onEdgeClick,
  selectedNodes = [],
  pinnedNodes: pinnedNodesProp = [],
  highlightedPath,
  isolatedNodes,
  setIsolatedNeighborhood,
  isReconstructing = false
}: SupernodeClusterViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const simulationRef = useRef<d3.Simulation<ForceNode, undefined> | null>(null)
  const tickCountRef = useRef(0)
  const positionCacheRef = useRef(new Map<string, { x: number; y: number }>())
  const nodeSelectionRef = useRef<d3.Selection<SVGGElement, ForceNode, SVGSVGElement, unknown> | null>(null)
  const onNodeHoverRef = useRef<typeof onNodeHover>(onNodeHover)
  const onNodeClickRef = useRef<typeof onNodeClick>(onNodeClick)
  const onNeighborhoodIsolateRef = useRef<typeof onNeighborhoodIsolate>(onNeighborhoodIsolate)
  const neighborsNRef = useRef<number>(neighborsN)
  const pinnedNodesRef = useRef<Set<string>>(new Set())

  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null)
  const [clickedNode, setClickedNode] = useState<GraphNode | null>(null)
  const [pinnedNodes, setPinnedNodes] = useState<Set<string>>(new Set())
  const [isolatedNeighborhood, setIsolatedNeighborhoodState] = useState<Set<string>>(new Set())
  const [tooltip, setTooltip] = useState<{ x: number; y: number; content: string } | null>(null)

  // Sync external pinnedNodes prop to internal state
  useEffect(() => {
    if (pinnedNodesProp && Array.isArray(pinnedNodesProp)) {
      setPinnedNodes(new Set(pinnedNodesProp))
    }
  }, [pinnedNodesProp])

  // Keep refs in sync (avoid re-creating handlers/effects)
  useEffect(() => { onNodeHoverRef.current = onNodeHover }, [onNodeHover])
  useEffect(() => { onNodeClickRef.current = onNodeClick }, [onNodeClick])
  useEffect(() => { onNeighborhoodIsolateRef.current = onNeighborhoodIsolate }, [onNeighborhoodIsolate])
  useEffect(() => { neighborsNRef.current = neighborsN }, [neighborsN])
  useEffect(() => { pinnedNodesRef.current = pinnedNodes }, [pinnedNodes])

  // Sync external isolatedNodes prop to internal state
  useEffect(() => {
    if (isolatedNodes && Array.isArray(isolatedNodes) && isolatedNodes.length > 0) {
      setIsolatedNeighborhoodState(new Set(isolatedNodes))
    } else if (isolatedNodes && isolatedNodes.length === 0) {
      setIsolatedNeighborhoodState(new Set())
    }
  }, [isolatedNodes])

  // Parse supernode data - only show actual supernodes (nodes with multiple members)
  const nodes = React.useMemo(() => {
    if (!data?.nodes) return []

    return data.nodes
      .filter((sn: any) => sn.members && sn.members.length > 1)
      .map((sn: any) => ({
        id: sn.id,
        label: sn.id,
        layer: sn.layer || 0,
        size: sn.size,
        members: sn.members || [],
        isSuperNode: true,
        expanded: false,
        pinned: false,
        nodeColor: getLayerColor(sn.layer || 0),
        sourceLinks: [],
        targetLinks: [],
        x: positionCacheRef.current.get(sn.id)?.x,
        y: positionCacheRef.current.get(sn.id)?.y
      })) as GraphNode[]
  }, [data])

  // Convert links/edges to use node objects instead of IDs for D3 force layout
  const links = React.useMemo(() => {
    const rawLinks = (data?.links ?? data?.edges ?? []) as Array<any>;
    if (!rawLinks.length || !nodes.length) return [];
    
    return rawLinks
      .map((link: any) => {
        const sourceId = typeof link.source === 'string' ? link.source : link.source?.id;
        const targetId = typeof link.target === 'string' ? link.target : link.target?.id;
        
        const sourceNode = nodes.find(n => n.id === sourceId);
        const targetNode = nodes.find(n => n.id === targetId);
        
        if (!sourceNode || !targetNode) {
          return null;
        }
        
        return {
          source: sourceNode,
          target: targetNode,
          weight: link.weight || 1,
          value: link.value || link.weight || 1
        };
      })
      .filter(Boolean) as ForceLink[];
  }, [nodes, data?.links, data?.edges]);

  // Compute visible nodes and links based on isolation
  const { visibleNodes, visibleLinks } = useMemo(() => {
    if (isolatedNeighborhood.size === 0) {
      return { visibleNodes: nodes, visibleLinks: links };
    }
    
    const visibleNodes = nodes.filter(node => isolatedNeighborhood.has(node.id));
    const visibleNodeIds = new Set(visibleNodes.map(n => n.id));
    const visibleLinks = links.filter(link => 
      visibleNodeIds.has((link.source as ForceNode).id) && 
      visibleNodeIds.has((link.target as ForceNode).id)
    );
    
    return { visibleNodes, visibleLinks };
  }, [nodes, links, isolatedNeighborhood]);

  // Draw edges on canvas
  const drawEdges = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const context = canvas.getContext('2d');
    if (!context) return;
    
    context.clearRect(0, 0, canvas.width, canvas.height);
    
    visibleLinks.forEach(link => {
      const source = link.source as ForceNode;
      const target = link.target as ForceNode;
      
      if (!source.x || !source.y || !target.x || !target.y) return;
      
      const opacity = Math.max(0.1, Math.min(1, (link.weight || 1) * 0.5));
      
      context.beginPath();
      context.moveTo(source.x, source.y);
      context.lineTo(target.x, target.y);
      context.strokeStyle = `rgba(100, 100, 100, ${opacity})`;
      context.lineWidth = Math.max(0.5, Math.min(3, (link.weight || 1) * 2));
      context.stroke();
    });
  }, [visibleLinks]);

  // Handle canvas resize
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    
    const resizeCanvas = () => {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      drawEdges();
    };
    
    resizeCanvas();
    
    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(container);
    
    return () => resizeObserver.disconnect();
  }, [drawEdges]);

  // Handle node interactions
  const handleNodeHover = (node: GraphNode | null, event?: MouseEvent) => {
    setHoveredNode(node);
    const cb = onNodeHoverRef.current;
    if (cb) cb(node);
    if (node && event) {
      setTooltip({
        x: event.clientX + 10,
        y: event.clientY - 10,
        content: `${node.label || node.id}\nLayer: ${node.layer}\nMembers: ${node.members?.length || 0}`
      });
    } else {
      setTooltip(null);
    }
  };

  const handleNodeClick = (node: GraphNode, event: MouseEvent) => {
    event.stopPropagation();
    if (event.ctrlKey || event.metaKey) {
      const iso = onNeighborhoodIsolateRef.current;
      if (iso) iso(node, neighborsNRef.current);
    } else {
      setClickedNode(node);
      const cb = onNodeClickRef.current;
      if (cb) cb(node);
    }
  };

  // Initialize force simulation
  const initializeSimulation = useCallback(() => {
    if (!svgRef.current || !containerRef.current) {
      return null;
    }

    if (!visibleNodes.length) {
      return null;
    }

    const svg = d3.select(svgRef.current);
    const container = containerRef.current;
    const rect = container.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    // Assign deterministic initial positions for nodes with no cached pos
    (visibleNodes as ForceNode[]).forEach((n) => {
      if (n.x == null || n.y == null) {
        const base = `${n.id}:${(n as any).layer ?? 0}`;
        const a = hashToUnit(base) * Math.PI * 2;
        const rUnit = hashToUnit(base + '|r');
        const radius = Math.max(40, Math.min(width, height) * (0.25 + 0.35 * rUnit));
        n.x = width / 2 + Math.cos(a) * radius;
        n.y = height / 2 + Math.sin(a) * radius;
      }
    });

    // Create or reuse simulation
    let simulation = simulationRef.current;
    if (!simulation) {
      simulation = d3.forceSimulation<ForceNode>(visibleNodes as ForceNode[])
        .force('link', d3.forceLink<ForceNode, ForceLink>(visibleLinks)
          .id(d => d.id)
          .distance(100)
          .strength(0.1)
        )
        .force('charge', d3.forceManyBody().strength(-300))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius((d: any) => Math.sqrt(d.size || 10) * 3 + 5))
        .alphaDecay(0.02)
        .velocityDecay(0.3);
      simulationRef.current = simulation;
    }

    // Update nodes/links without tearing down DOM
    const dataJoin = svg.selectAll<SVGGElement, ForceNode>('.node-group')
      .data(visibleNodes as ForceNode[], d => d.id);

    const entered = dataJoin.enter()
      .append('g')
      .attr('class', 'node-group')
      .style('cursor', 'pointer');

    entered.append('circle')
      .attr('r', d => Math.sqrt(d.size || 10) * 3)
      .attr('fill', d => d.nodeColor || '#69b3a2')
      .attr('stroke', '#333')
      .attr('stroke-width', 1)
      .attr('opacity', 1);

    entered.append('text')
      .text(d => d.label || d.id)
      .attr('text-anchor', 'middle')
      .attr('dy', d => Math.sqrt(d.size || 10) * 3 + 15)
      .attr('font-size', '12px')
      .attr('fill', darkMode ? '#fff' : '#333')
      .attr('opacity', 1)
      .style('display', showLabels ? '' : 'none');

    const nodeGroups = entered.merge(dataJoin as any);

    nodeGroups
      .on('mouseover', (event, d) => handleNodeHover(d, event))
      .on('mouseout', () => handleNodeHover(null))
      .on('click', (event, d) => handleNodeClick(d, event));

    const drag = d3.drag<SVGGElement, ForceNode>()
      .on('start', (event, d) => {
        if (!event.active && simulation) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active && simulation) simulation.alphaTarget(0);
        if (!pinnedNodesRef.current.has(d.id)) {
          d.fx = null;
          d.fy = null;
        }
      });

    nodeGroups.call(drag);

    // Save selection for tick updates
    nodeSelectionRef.current = nodeGroups as any;

    // Update simulation with latest data
    simulation.nodes(visibleNodes as ForceNode[]);
    const linkForce: any = simulation.force('link');
    if (linkForce) linkForce.links(visibleLinks as any);

    // Attach/upsert tick to use latest selection and edges
    simulation.on('tick', () => {
      const sel = nodeSelectionRef.current;
      if (sel) {
        sel.attr('transform', d => `translate(${d.x || 0},${d.y || 0})`);
        sel.each((d: any) => {
          positionCacheRef.current.set(d.id, { x: d.x || 0, y: d.y || 0 });
        });
      }
      if (tickCountRef.current % 5 === 0) {
        drawEdges();
      }
      tickCountRef.current += 1;
    });

    // Immediately reflect current positions without running forces
    nodeGroups.attr('transform', d => `translate(${d.x || 0},${d.y || 0})`);
    drawEdges();

    // Freeze to avoid jitter on data updates; user interactions will nudge it
    simulation.alpha(0);
    simulation.stop();

    return simulation;
  }, [visibleNodes, visibleLinks, drawEdges]);

  useEffect(() => {
    const simulation = initializeSimulation();
    if (simulation) {
      simulationRef.current = simulation;
    }
  }, [initializeSimulation])

  // Update node styles reactively without re-initializing the simulation
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const nodeGroups = svg.selectAll<SVGGElement, ForceNode>('.node-group');

    nodeGroups.select('circle')
      .attr('stroke', (d: any) => {
        if (selectedNodes.includes(d.id)) return '#ff6b6b';
        if (pinnedNodes.has(d.id)) return '#ffd93d';
        if (highlightedPath?.includes(d.id)) return '#4ecdc4';
        return '#333';
      })
      .attr('stroke-width', (d: any) => (
        selectedNodes.includes(d.id) || pinnedNodes.has(d.id) || highlightedPath?.includes(d.id) ? 3 : 1
      ))
      .attr('opacity', (d: any) => (hoveredNode && hoveredNode.id !== d.id ? 0.3 : 1));

    nodeGroups.select('text')
      .attr('fill', darkMode ? '#fff' : '#333')
      .attr('opacity', (d: any) => (hoveredNode && hoveredNode.id !== d.id ? 0.3 : 1))
      .style('display', showLabels ? '' : 'none');

    // Optional: redraw edges to reflect any visual changes
    drawEdges();
  }, [hoveredNode, selectedNodes, pinnedNodes, highlightedPath, showLabels, darkMode, drawEdges]);

  // Pause simulation while reconstructing to prevent jitter
  useEffect(() => {
    const sim = simulationRef.current;
    if (!sim) return;
    if (isReconstructing) {
      sim.stop();
    }
  }, [isReconstructing]);

  const clearIsolation = useCallback(() => {
    if (setIsolatedNeighborhood) {
      setIsolatedNeighborhood(new Set());
    }
  }, [setIsolatedNeighborhood])

  if (!data?.nodes?.length) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center p-8">
          <div className="text-4xl mb-4">📊</div>
          <h3 className="text-lg font-medium mb-2">No data available</h3>
          <p className="text-gray-500">
            The graph data is empty or failed to load.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-full bg-white dark:bg-gray-900 flex">
      <div className={`relative ${clickedNode ? 'w-2/3' : 'w-full'} h-full transition-all duration-300`}>
        {isolatedNeighborhood.size > 0 && (
          <div className="absolute top-4 right-4 bg-blue-100 border border-blue-400 text-blue-700 px-4 py-3 rounded z-10">
            <div className="flex items-center justify-between">
              <span>Showing neighborhood ({isolatedNeighborhood.size} nodes)</span>
              <button
                onClick={clearIsolation}
                className="ml-2 text-blue-700 hover:text-blue-900 font-bold"
              >
                ×
              </button>
            </div>
          </div>
        )}

        {tooltip && (
          <div
            className="absolute bg-gray-800 text-white text-xs rounded px-2 py-1 pointer-events-none z-10"
            style={{
              left: tooltip.x,
              top: tooltip.y,
              maxWidth: '200px'
            }}
          >
            {tooltip.content}
          </div>
        )}

        <svg
          ref={svgRef}
          className="absolute inset-0 w-full h-full"
          style={{ zIndex: 1 }}
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ zIndex: 0 }}
        />
      </div>

      {clickedNode && (
        <div className="w-1/3 h-full bg-gray-50 dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 overflow-y-auto">
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Supernode Details
              </h3>
              <button
                onClick={() => setClickedNode(null)}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                ×
              </button>
            </div>

            <div className="mb-4 p-3 bg-white dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600">
              <div className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                {clickedNode.label}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-300 space-y-1">
                <div>Layer: {clickedNode.layer}</div>
                <div>Size: {clickedNode.size}</div>
                <div>Member Count: {clickedNode.members?.length || 0}</div>
              </div>
            </div>

            <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
              Member Nodes ({clickedNode.members?.length || 0})
            </h4>
            <div className="space-y-2">
              {clickedNode.members?.map((memberId, index) => (
                <div
                  key={`member-${memberId}`}
                  className="p-2 bg-white dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600"
                >
                  <div className="text-sm font-mono text-gray-900 dark:text-white">
                    {memberId}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    Member #{index + 1}
                  </div>
                </div>
              )) || (
                <div className="text-sm text-gray-500 dark:text-gray-400 italic">
                  No members found
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SupernodeClusterView;
