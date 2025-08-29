// Enhanced Graph Route - Comprehensive visualization with all features
import React, { useState, useCallback, useEffect, ErrorInfo, useRef } from 'react'
import { Link } from 'react-router-dom'
import AttributionRailView from './AttributionRailView'
import SupernodeClusterView from './SupernodeClusterView'
import InteractiveControls from './InteractiveControls'
import AnalysisControls, { type AnalysisParams } from './AnalysisControls'
import VisualizationControls from './VisualizationControls'
import TimelineControls from './TimelineControls'
import PerformanceOptimizer from './PerformanceOptimizer'
import ExportUtils, { ErrorToast, SuccessToast } from './ExportUtils'
import type { GraphNode } from '../lib/graph-types'
import type { NeuronpediaJSON } from '../lib/neuronpedia-parser'
import { parseNeuronpediaJSON } from '../lib/neuronpedia-parser'
import { labelResolver } from '../services/labels/labelResolver'
import type { LabelMode } from '../services/labels/autoInterp'
import { SupernodeService, type ReconstructionConfig } from '../services/supernodes'

// Sample data for testing (will be replaced with actual charlotte data)
const charlotteData = {
  metadata: {
    slug: "sample-attribution",
    scan: "gemma-2-2b",
    prompt_tokens: ["<bos>", "Fact", ":", " The", " capital", " of", " Charlotte", " is"],
    prompt: "<bos>Fact: The capital of Charlotte is",
    node_threshold: 0.8,
    schema_version: 1,
    info: {
      creator_name: "EASE System",
      creator_url: "https://ease.ai",
      source_urls: [],
      generator: { name: "EASE", version: "1.0.0", url: "" },
      create_time_ms: Date.now()
    },
    generation_settings: { max_n_logits: 10, desired_logit_prob: 0.95, batch_size: 48, max_feature_nodes: 5000 },
    pruning_settings: { node_threshold: 0.8, edge_threshold: 0.85 }
  },
  qParams: { pinnedIds: [], supernodes: [], linkType: "both", clickedId: "", sg_pos: "" },
  nodes: [
    { node_id: "0_355_1", feature: 63545, layer: "0", ctx_idx: 1, feature_type: "cross layer transcoder", token_prob: 0, is_target_logit: false, run_idx: 0, reverse_ctx_idx: 0, jsNodeId: "0_355-0", clerp: "Money and analysis", influence: 0.7587905526161194, activation: 1.859375 },
    { node_id: "0_437_1", feature: 96140, layer: "0", ctx_idx: 1, feature_type: "cross layer transcoder", token_prob: 0, is_target_logit: false, run_idx: 0, reverse_ctx_idx: 0, jsNodeId: "0_437-0", clerp: "Metadata and associative terms", influence: 0.6777538657188416, activation: 2.296875 },
    { node_id: "1_123_2", feature: 12345, layer: "1", ctx_idx: 2, feature_type: "attention", token_prob: 0, is_target_logit: false, run_idx: 0, reverse_ctx_idx: 0, jsNodeId: "1_123-0", clerp: "Attention head", influence: 0.8, activation: 1.5 },
    { node_id: "2_456_3", feature: 45678, layer: "2", ctx_idx: 3, feature_type: "logit", token_prob: 0.95, is_target_logit: true, run_idx: 0, reverse_ctx_idx: 0, jsNodeId: "2_456-0", clerp: "Output logit", influence: 0.9, activation: 3.2 }
  ],
  edges: [
    { source: "0_355_1", target: "1_123_2", weight: 0.6 },
    { source: "0_437_1", target: "1_123_2", weight: 0.4 },
    { source: "1_123_2", target: "2_456_3", weight: 0.8 }
  ]
}

type ViewMode = 'attribution' | 'supernode'

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 bg-red-50 text-red-800 rounded-lg">
          <h2 className="font-bold text-lg mb-2">Something went wrong</h2>
          <p>{this.state.error?.message}</p>
          <pre className="mt-2 p-2 bg-black/10 rounded text-xs overflow-auto">
            {this.state.error?.stack}
          </pre>
          <button 
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-2 px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function EnhancedGraphRoute() {
  // View state
  const [viewMode, setViewMode] = useState<ViewMode>('attribution')
  const [initializationError, setInitializationError] = useState<string | null>(null)
  const [darkMode, setDarkMode] = useState(false)
  
  // Visualization controls
  const [layout, setLayout] = useState<'force' | 'layered'>('layered')
  const [edgeOpacityThreshold, setEdgeOpacityThreshold] = useState(0.1)
  const [showLabels, setShowLabels] = useState(true)
  const [neighborsN, setNeighborsN] = useState(2)
  const [labelMode, setLabelMode] = useState<LabelMode>('autointerp')
  
  // Interactive state
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedNodes, setSelectedNodes] = useState<string[]>([])
  const [pinnedNodes, setPinnedNodes] = useState<string[]>([])
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const [clickedNode, setClickedNode] = useState<string | null>(null)
  const [highlightedPath, setHighlightedPath] = useState<string[]>([])
  const [isolatedNodes, setIsolatedNodes] = useState<string[]>([])
  const [lassoMode, setLassoMode] = useState(false)
  
  // Analysis state
  const [analysisResults, setAnalysisResults] = useState<any>(null)
  const [isRunning, setIsRunning] = useState(false)
  const ANALYSIS_TIMEOUT_MS = 120000
  
  // Supernode state
  const [supernodeData, setSupernodeData] = useState<any>(null)
  const [supernodeConfig, setSupernodeConfig] = useState<ReconstructionConfig | null>(null)
  const [isLoadingSupernodes, setIsLoadingSupernodes] = useState(false)
  const [charlotteData, setCharlotteData] = useState<any>(null)
  // Guard against infinite auto-retries on failure
  const hasAttemptedSupernodesRef = useRef(false)
  
  // Timeline state
  const [currentStep, setCurrentStep] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [totalSteps] = useState(100)
  
  // Performance state
  const [enableWebGL, setEnableWebGL] = useState(false)
  const [topKEdges, setTopKEdges] = useState(1000)
  
  // Toast state
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [labelOverrides, setLabelOverrides] = useState<Record<string, string>>({})

  // Load Charlotte data and supernode config on mount
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        console.log('Loading initial data...')
        const [data, config] = await Promise.all([
          SupernodeService.getCharlotteData(),
          SupernodeService.getCharlottePresetConfig()
        ])
        console.log('Data loaded:', { data: data ? 'success' : 'empty', config: config ? 'success' : 'empty' })
        setCharlotteData(data)
        setSupernodeConfig(config)
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error occurred'
        console.error('Failed to load initial data:', error)
        
        // Check if it's a network connectivity issue
        if (errorMsg.includes('fetch') || errorMsg.includes('NetworkError') || errorMsg.includes('Failed to fetch')) {
          setInitializationError(`Backend server connection failed. Please ensure the backend is running on localhost:8000. Error: ${errorMsg}`)
          setErrorMessage('Backend server not reachable - check if it\'s running on port 8000')
        } else {
          setInitializationError(`Failed to load initial data: ${errorMsg}`)
          setErrorMessage('Failed to load initial data')
        }
      }
    }
    loadInitialData()
  }, [])

  // Parse data using neuronpedia parser
  const parsedData = charlotteData ? parseNeuronpediaJSON(charlotteData as NeuronpediaJSON) : { nodes: [], edges: [] }
  
  // Create proper GraphNode format from parsed data
  // Preserve fields like featureId, ctx_idx, clerp/ppClerp for label resolution and search
  const graphNodes: GraphNode[] = parsedData.nodes.map(node => ({
    ...node
  }))

  // Preload labels for top nodes when component mounts or labelMode changes
  useEffect(() => {
    labelResolver.preloadTopNodeLabels(graphNodes, labelMode, 20)
  }, [graphNodes, labelMode])

  // Load supernodes once when switching to supernode view
  useEffect(() => {
    if (
      viewMode === 'supernode' &&
      charlotteData &&
      supernodeConfig &&
      !supernodeData &&
      !isLoadingSupernodes &&
      !hasAttemptedSupernodesRef.current
    ) {
      hasAttemptedSupernodesRef.current = true
      loadSupernodes()
    }
  }, [viewMode, charlotteData, supernodeConfig, supernodeData, isLoadingSupernodes])

  // Allow retry if user toggles away and back to supernode view
  useEffect(() => {
    if (viewMode !== 'supernode') {
      hasAttemptedSupernodesRef.current = false
    }
  }, [viewMode])

  const loadSupernodes = async () => {
    if (!charlotteData || !supernodeConfig) {
      console.warn('[EnhancedGraphRoute] loadSupernodes: Missing data', { charlotteData: !!charlotteData, supernodeConfig: !!supernodeConfig })
      return
    }
    
    setIsLoadingSupernodes(true)
    setErrorMessage(null)
    
    try {
      const start = (typeof performance !== 'undefined' ? performance.now() : Date.now())
      console.log('[EnhancedGraphRoute] loadSupernodes → reconstructCharlotteSupernodes', {
        config: supernodeConfig,
        apiBase: (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) ? 'http://localhost:8000' : 'relative'
      })

      const result = await SupernodeService.reconstructCharlotteSupernodes(supernodeConfig, ANALYSIS_TIMEOUT_MS)
      const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - start
      console.log('[EnhancedGraphRoute] loadSupernodes ← result', { stats: result?.stats, elapsedMs: Math.round(elapsed) })

      const convertedData = SupernodeService.convertToSupernodeData(result)
      console.log('[EnhancedGraphRoute] supernodeData set', {
        nodeCount: convertedData.nodes?.length || 0,
        edgeCount: convertedData.edges?.length || 0,
      })
      setSupernodeData(convertedData)
      const merges = Array.isArray(result?.merge_log) ? result.merge_log.length : (typeof result?.stats?.candidates_passed_gate === 'number' ? result.stats.candidates_passed_gate : 0)
      setSuccessMessage(`Merged ${merges} pairs • ${result.stats.num_supernodes} supernodes • CR ${result.stats.compression_ratio.toFixed(2)}`)
    } catch (error) {
      console.error('Failed to reconstruct supernodes:', error)
      const msg = (error instanceof Error ? error.message : String(error))
      
      // Provide more specific error messages
      if (msg.includes('timed out')) {
        setErrorMessage('Supernode generation timed out - the dataset may be too large')
      } else if (msg.includes('fetch') || msg.includes('NetworkError') || msg.includes('Failed to fetch')) {
        setErrorMessage('Backend connection failed - ensure server is running on port 8000')
      } else if (msg.includes('500')) {
        setErrorMessage('Backend processing error - check server logs for details')
      } else {
        setErrorMessage(`Failed to generate supernodes: ${msg}`)
      }
    } finally {
      setIsLoadingSupernodes(false)
    }
  }

  // Safety net: ensure loading state cannot persist indefinitely
  useEffect(() => {
    if (!isLoadingSupernodes) return
    const safety = setTimeout(() => {
      console.warn('[EnhancedGraphRoute] Safety timeout: supernode loading still in progress, resetting flag')
      setIsLoadingSupernodes(false)
      setErrorMessage((prev: string | null) => prev || 'Supernode generation timed out')
    }, ANALYSIS_TIMEOUT_MS + 5000)
    return () => clearTimeout(safety)
  }, [isLoadingSupernodes])

  // Generate meaningful groups from sample data showing actual feature concepts
  const groups = React.useMemo(() => {
    // Use real supernodes if available, otherwise fall back to heuristic grouping
    if (supernodeData?.nodes) {
      return supernodeData.nodes.map((supernode: any) => ({
        id: supernode.id,
        name: `Supernode ${supernode.id} (${supernode.size} members)`,
        members: supernode.members,
        size: supernode.size,
        layer: supernode.layer
      }))
    }

    // Fallback: Group by layer or other meaningful attributes
    const layerGroups = new Map<number, GraphNode[]>();
    graphNodes.forEach(node => {
      const layer = node.layer || 0;
      if (!layerGroups.has(layer)) {
        layerGroups.set(layer, []);
      }
      layerGroups.get(layer)!.push(node);
    });

    const semanticGroups = Array.from(layerGroups.entries()).map(([layer, nodes]) => ({
      id: `layer_${layer}`,
      name: `Layer ${layer} Nodes`,
      members: nodes
    })).filter(group => group.members.length > 1) // Only show layers with multiple nodes
    
    // Add remaining ungrouped nodes as individual groups
    const groupedNodeIds = new Set(semanticGroups.flatMap(g => g.members.map(m => m.id)))
    const ungroupedNodes = graphNodes.filter(node => !groupedNodeIds.has(node.id))
    
    ungroupedNodes.forEach(node => {
      semanticGroups.push({
        id: `individual_${node.id}`,
        name: node.clerp || node.ppClerp || `Feature ${node.id}`,
        members: [node]
      })
    })
    
    return semanticGroups.map(group => ({
      id: group.id,
      name: group.name,
      members: group.members,
      size: group.members.length
    }))
  }, [graphNodes])

  // Legacy supernode data for cluster view (fallback when real supernodes not available)
  const legacySupernodeData = React.useMemo(() => ({
    nodes: groups.map((group: any) => ({
      id: group.id,
      size: group.size,
      layer: group.members[0]?.layer || 0,
      members: group.members.map((m: any) => m.id)
    })),
    edges: [
      { source: groups[0]?.id || 'financial_analysis', target: groups[2]?.id || 'attention_mechanisms', weight: 0.7 },
      { source: groups[1]?.id || 'metadata_processing', target: groups[2]?.id || 'attention_mechanisms', weight: 0.4 },
      { source: groups[2]?.id || 'attention_mechanisms', target: groups[3]?.id || 'output_logits', weight: 0.8 }
    ].filter(edge => edge.source && edge.target)
  }), [groups])

  // Analysis handlers - trigger backend supernode reconstruction
  const handleRunAnalysis = useCallback(async (params: AnalysisParams) => {
    if (!charlotteData) {
      setErrorMessage('No attribution data loaded yet')
      return
    }

    setIsRunning(true)
    try {
      const startedAt = (typeof performance !== 'undefined' ? performance.now() : Date.now())
      console.log('[EnhancedGraphRoute] Run Analysis → start', {
        params,
        nodes: Array.isArray(charlotteData?.nodes) ? charlotteData.nodes.length : 0,
        edges: Array.isArray(charlotteData?.edges) ? charlotteData.edges.length : 0,
      })
      setAnalysisResults({ status: 'running', params } as any)
      const cfg: Partial<ReconstructionConfig> = {
        tau_sim: params.tau_sim,
        alpha: params.alpha,
        beta: params.beta,
        intra_layer_only: false
      }

      const result = await SupernodeService.reconstructCharlotteSupernodes(cfg, ANALYSIS_TIMEOUT_MS)
      const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt
      console.log('[EnhancedGraphRoute] Run Analysis ← result', { stats: result?.stats, elapsedMs: Math.round(elapsed) })

      const converted = SupernodeService.convertToSupernodeData(result)
      console.log('[EnhancedGraphRoute] supernodeData set (analysis)', {
        nodeCount: converted.nodes?.length || 0,
        edgeCount: converted.edges?.length || 0,
      })
      setSupernodeData(converted)
      setAnalysisResults({ status: 'completed', params, stats: result.stats } as any)
      const merges = Array.isArray(result?.merge_log) ? result.merge_log.length : (typeof result?.stats?.candidates_passed_gate === 'number' ? result.stats.candidates_passed_gate : 0)
      setSuccessMessage(`Merged ${merges} pairs • ${result.stats.num_supernodes} supernodes • CR ${result.stats.compression_ratio.toFixed(2)}`)
    } catch (error) {
      console.error('Supernode reconstruction failed:', error)
      const msg = (error instanceof Error ? error.message : String(error))
      setAnalysisResults({ status: 'failed', params, error: msg } as any)
      setErrorMessage(msg.includes('timed out') ? 'Supernode reconstruction timed out' : 'Supernode reconstruction failed')
    } finally {
      setIsRunning(false)
      console.log('[EnhancedGraphRoute] Run Analysis → finished')
    }
  }, [charlotteData])

  // Safety net: ensure running state cannot persist indefinitely
  useEffect(() => {
    if (!isRunning) return
    const safety = setTimeout(() => {
      console.warn('[EnhancedGraphRoute] Safety timeout: analysis still running, forcing reset')
      setIsRunning(false)
      setAnalysisResults((prev: any) => prev && prev.status === 'running' ? { ...prev, status: 'failed', error: 'Client-side safety timeout' } : prev)
      setErrorMessage((prev: string | null) => prev || 'Analysis timed out')
    }, ANALYSIS_TIMEOUT_MS + 5000)
    return () => clearTimeout(safety)
  }, [isRunning])

  const handleResetAnalysis = useCallback(() => {
    setAnalysisResults(null)
    setIsRunning(false)
  }, [])

  // Timeline handlers
  const handleStepChange = useCallback((step: number) => {
    setCurrentStep(step)
  }, [])

  const handlePlayPause = useCallback(() => {
    setIsPlaying(!isPlaying)
  }, [isPlaying])

  const handleSpeedChange = useCallback((speed: number) => {
    setPlaybackSpeed(speed)
  }, [])

  const handleStepForward = useCallback(() => {
    setCurrentStep(prev => Math.min(prev + 1, totalSteps))
  }, [totalSteps])

  const handleStepBackward = useCallback(() => {
    setCurrentStep(prev => Math.max(prev - 1, 0))
  }, [])

  const handleJumpSteps = useCallback((delta: number) => {
    setCurrentStep(prev => Math.max(0, Math.min(prev + delta, totalSteps)))
  }, [totalSteps])

  // Toast handlers
  const handleError = useCallback((message: string) => {
    setErrorMessage(message)
    setTimeout(() => setErrorMessage(null), 5000)
  }, [])

  const handleSuccess = useCallback((message: string) => {
    setSuccessMessage(message)
    setTimeout(() => setSuccessMessage(null), 3000)
  }, [])

  // Visualization handlers
  const handleResetVisualization = useCallback(() => {
    setSelectedNodes([])
    setPinnedNodes([])
    setHoveredNode(null)
    setClickedNode(null)
    setHighlightedPath([])
    setIsolatedNodes([])
    setSearchQuery('')
  }, [])

  const handleFitToView = useCallback(() => {
    // Trigger fit-to-view in the active visualization
    console.log('Fit to view triggered')
  }, [])

  // Interactive handlers
  const handleSearch = useCallback((query: string, results: GraphNode[]) => {
    setSearchQuery(query)
    setSelectedNodes(results.map(node => node.id))
  }, [])

  const handleLassoSelect = useCallback((selectedNodes: GraphNode[]) => {
    console.log('Lasso selected nodes:', selectedNodes.map(n => n.id))
  }, [])

  const handlePinNodes = useCallback((nodeIds: string[]) => {
    setPinnedNodes(prev => [...prev, ...nodeIds])
  }, [])

  const handleExportLabels = useCallback(() => {
    console.log('Exporting labels...')
  }, [])

  const handleImportLabels = useCallback((labels: Record<string, string>) => {
    setLabelOverrides(labels)
    console.log('Imported labels:', Object.keys(labels).length)
  }, [])

  // Handle label mode change
  const handleLabelModeChange = useCallback((mode: LabelMode) => {
    setLabelMode(mode)
    // Preload labels for top nodes when switching modes
    if (graphNodes.length > 0) {
      labelResolver.preloadTopNodeLabels(graphNodes, mode, 50).catch(console.error)
    }
  }, [graphNodes])

  const handleNeighborhoodIsolate = useCallback((node: GraphNode, hops: number) => {
    console.log(`Isolating ${hops}-hop neighborhood of ${node.id}`)
  }, [])

  // Apply dark mode to document
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [darkMode])

  // Show initialization error if any
  if (initializationError) {
    return (
      <div className="p-8 bg-red-50 text-red-800">
        <h1 className="text-2xl font-bold mb-4">Initialization Error</h1>
        <p className="mb-4">{initializationError}</p>
        <p className="text-sm text-red-700 mb-4">
          Please check the browser console for more details and ensure the backend server is running.
        </p>
        <button 
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Reload Page
        </button>
      </div>
    )
  }

  return (
    <ErrorBoundary>
      <div className={`flex h-screen ${darkMode ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-900'}`}>
      {/* Left Sidebar - Controls */}
      <div className={`w-80 border-r overflow-y-auto ${
        darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
      }`}>
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-xl font-bold">EASE Graphs</h1>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                Interactive graph visualizations
              </p>
            </div>
            <Link 
              to="/" 
              className="px-3 py-1 text-sm bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
            >
              ← EASE
            </Link>
          </div>

          {/* View Mode Selector */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold">View Mode</label>
            <div className="grid grid-cols-2 gap-1">
              <button
                onClick={() => setViewMode('attribution')}
                className={`px-3 py-2 text-sm rounded transition-colors ${
                  viewMode === 'attribution'
                    ? 'bg-blue-500 text-white'
                    : darkMode
                      ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                Attribution Rail
              </button>
              <button
                onClick={() => setViewMode('supernode')}
                className={`px-3 py-2 text-sm rounded transition-colors ${
                  viewMode === 'supernode'
                    ? 'bg-blue-500 text-white'
                    : darkMode
                      ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                Supernode Clusters
              </button>
            </div>
          </div>
        </div>

        {/* Control Panels */}
        <div className="p-4 space-y-6">
          {/* Analysis Controls */}
          <AnalysisControls
            onRun={handleRunAnalysis}
            onReset={handleResetAnalysis}
            isRunning={isRunning}
            darkMode={darkMode}
          />

          {/* Visualization Controls */}
          <VisualizationControls
            layout={layout}
            edgeOpacityThreshold={edgeOpacityThreshold}
            showLabels={showLabels}
            neighborsN={neighborsN}
            darkMode={darkMode}
            onLayoutChange={setLayout}
            onEdgeOpacityChange={setEdgeOpacityThreshold}
            onLabelsToggle={setShowLabels}
            onNeighborsChange={setNeighborsN}
          />

          {/* Interactive Controls */}
          <InteractiveControls
            nodes={graphNodes}
            edges={('links' in parsedData ? parsedData.links : parsedData.edges || []).map((link: any) => ({
              source: typeof link.source === 'string' ? link.source : link.source.id,
              target: typeof link.target === 'string' ? link.target : link.target.id,
              weight: link.weight || 0
            }))}
            groups={groups}
            onSearch={(query, results) => {
              console.log('Search:', query, results.length, 'results')
            }}
            onLassoSelect={(nodes) => {
              setSelectedNodes(nodes.map(n => n.id))
            }}
            onPinNodes={(nodeIds) => {
              setPinnedNodes(prev => [...new Set([...prev, ...nodeIds])])
            }}
            onGroupClick={(groupId) => {
              console.log('Group clicked:', groupId)
              const group = groups.find((g: any) => g.id === groupId)
              if (group) {
                setSelectedNodes(group.members.map((m: any) => m.id))
                setSuccessMessage(`Selected ${group.members.length} features from "${group.name}" group`)
              }
            }}
            onEdgeClick={(source, target) => {
              console.log('Edge clicked:', source, '->', target)
              setHighlightedPath([source, target])
              setSuccessMessage(`Highlighted connection: ${source} → ${target}`)
            }}
            onExportLabels={() => {
              const labels = labelResolver.exportLabels()
              const blob = new Blob([JSON.stringify(labels, null, 2)], { type: 'application/json' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = 'labels.json'
              a.click()
              URL.revokeObjectURL(url)
              setSuccessMessage('Labels exported successfully')
            }}
            onImportLabels={(labels) => {
              // labels is already Record<string, string>
              labelResolver.importLabels(labels)
              setSuccessMessage('Labels imported successfully')
            }}
            onLabelModeChange={setLabelMode}
            labelMode={labelMode}
            darkMode={darkMode}
          />

          {/* Export Utils */}
          <div className={`border-b ${
            darkMode ? 'border-gray-600' : 'border-gray-200'
          }`}>
            <ExportUtils
              graphState={{
                viewMode,
                layout,
                edgeOpacity: edgeOpacityThreshold,
                showLabels,
                neighborHops: neighborsN,
                darkMode,
                searchQuery,
                pinnedNodes,
                selectedNodes,
                analysisParams: analysisResults?.params,
                nodes: charlotteData?.nodes || [],
                links: charlotteData?.edges || []
              }}
              darkMode={darkMode}
              onError={handleError}
              onSuccess={handleSuccess}
            />
          </div>

          {/* Performance Settings */}
          <div>
            <h3 className={`text-sm font-semibold mb-3 ${
              darkMode ? 'text-white' : 'text-gray-900'
            }`}>
              Performance
            </h3>
            
            <div className="space-y-3">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={enableWebGL}
                  onChange={(e) => setEnableWebGL(e.target.checked)}
                  className="mr-2 rounded"
                />
                <span className={`text-xs ${
                  darkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                  Enable WebGL (experimental)
                </span>
              </label>
              
              <div className="space-y-1">
                <label className={`block text-xs font-medium ${
                  darkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                  Max Edges: {topKEdges}
                </label>
                <input
                  type="range"
                  min="100"
                  max="10000"
                  step="100"
                  value={topKEdges}
                  onChange={(e) => setTopKEdges(parseInt(e.target.value))}
                  className="w-full"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Visualization Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className={`border-b px-4 py-3 ${
          darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
        }`}>
          <h2 className="text-lg font-semibold">
            {viewMode === 'attribution' ? 'Attribution Rail View' : 'Supernode Cluster View'}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {viewMode === 'attribution' 
              ? 'Token-to-logit attribution paths with layer-wise organization'
              : 'Force-directed clustering with expandable supernodes'
            }
          </p>
        </div>

        {/* Loading and Error States */}
        {initializationError && (
          <div className="mx-4 mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-start">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">Initialization Error</h3>
                <p className="mt-1 text-sm text-red-700">{initializationError}</p>
                <button 
                  onClick={() => window.location.reload()}
                  className="mt-2 px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700"
                >
                  Retry
                </button>
              </div>
            </div>
          </div>
        )}

        {isLoadingSupernodes && viewMode === 'supernode' && (
          <div className="mx-4 mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-blue-800">Loading Supernodes</h3>
                <p className="text-sm text-blue-700">Processing Charlotte dataset and reconstructing supernodes...</p>
              </div>
            </div>
          </div>
        )}

        {/* Visualization */}
        <div className="flex-1 relative">
          {viewMode === 'attribution' ? (
            <AttributionRailView
              data={charlotteData as NeuronpediaJSON}
              onNodeHover={(node: any) => setHoveredNode(node?.id || null)}
              onNodeClick={(node: any) => setClickedNode(node?.id || null)}
              onPathHighlight={(path: any) => setHighlightedPath(path || [])}
              edgeOpacityThreshold={edgeOpacityThreshold}
              showLabels={showLabels}
              labelMode={labelMode}
              darkMode={darkMode}
            />
          ) : (
            <div className="relative h-full">
              <SupernodeClusterView
                data={supernodeData || legacySupernodeData}
                layout={layout}
                edgeOpacityThreshold={edgeOpacityThreshold}
                showLabels={showLabels}
                neighborsN={neighborsN}
                isReconstructing={isLoadingSupernodes}
                onNodeHover={(node: any) => setHoveredNode(node?.id || null)}
                onNodeClick={(node: any) => setClickedNode(node?.id || null)}
                onNodeDoubleClick={(nodeId: any) => {
                  console.log('Node double-clicked:', nodeId)
                  setSuccessMessage(`Expanded/collapsed node: ${nodeId}`)
                }}
                onEdgeClick={(source: any, target: any) => {
                  console.log('Edge clicked:', source, '->', target)
                  setHighlightedPath([source, target])
                  setSuccessMessage(`Highlighted connection: ${source} → ${target}`)
                }}
                selectedNodes={selectedNodes}
                pinnedNodes={pinnedNodes}
                highlightedPath={highlightedPath}
                isolatedNodes={isolatedNodes}
                darkMode={darkMode}
              />

              {isLoadingSupernodes && (
                <div className="absolute inset-0 bg-white/70 dark:bg-black/60 backdrop-blur-sm flex items-center justify-center z-20">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                    <p className="text-gray-700 dark:text-gray-200">Reconstructing supernodes...</p>
                    <p className="text-sm text-gray-500 mt-1">This may take up to 60 seconds</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Status Bar */}
        <div className={`border-t px-4 py-2 text-xs ${
          darkMode ? 'bg-gray-800 border-gray-700 text-gray-400' : 'bg-gray-50 border-gray-200 text-gray-600'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              {hoveredNode && (
                <span>Hovered: {hoveredNode}</span>
              )}
              {selectedNodes.length > 0 && (
                <span>Selected: {selectedNodes.length} nodes</span>
              )}
              {isolatedNodes.length > 0 && (
                <span>Isolated: {isolatedNodes.length} nodes</span>
              )}
            </div>
            <div className="flex items-center space-x-4">
              {isRunning && (
                <span className="flex items-center">
                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-500 mr-2"></div>
                  Running analysis...
                </span>
              )}
              <span>Threshold: {edgeOpacityThreshold.toFixed(2)}</span>
              <span>Layout: {layout}</span>
            </div>
          </div>
        </div>
      </div>
      
      {/* Performance Optimizer (hidden, non-overlapping) */}
      <div className="hidden">
        <PerformanceOptimizer
          nodes={graphNodes}
          links={(('links' in (parsedData as any) ? (parsedData as any).links : (parsedData as any).edges) || []).map((link: any) => ({
            source: typeof link.source === 'string' ? link.source : link.source.id,
            target: typeof link.target === 'string' ? link.target : link.target.id,
            weight: link.weight || 0
          }))}
          topK={topKEdges}
          enableWebGL={enableWebGL}
          onRenderComplete={(stats) => {
            // Could show render stats in dev mode
            console.log('Render stats:', stats)
          }}
        />
      </div>
      
      {/* Toast Messages */}
      {errorMessage && (
        <ErrorToast
          message={errorMessage}
          onClose={() => setErrorMessage(null)}
          darkMode={darkMode}
        />
      )}
      
      {successMessage && (
        <SuccessToast
          message={successMessage}
          onClose={() => setSuccessMessage(null)}
          darkMode={darkMode}
        />
      )}
      </div>
    </ErrorBoundary>
  )
}
