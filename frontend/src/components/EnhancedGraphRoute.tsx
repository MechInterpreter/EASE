// Enhanced Graph Route - Comprehensive visualization with all features
import React, { useState, useCallback, useEffect } from 'react'
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

export default function EnhancedGraphRoute() {
  // View state
  const [viewMode, setViewMode] = useState<ViewMode>('attribution')
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

  // Parse data using neuronpedia parser
  const parsedData = parseNeuronpediaJSON(charlotteData as NeuronpediaJSON)
  
  // Create proper GraphNode format from parsed data
  // Preserve fields like featureId, ctx_idx, clerp/ppClerp for label resolution and search
  const graphNodes: GraphNode[] = parsedData.nodes.map(node => ({
    ...node
  }))

  // Preload labels for top nodes when component mounts or labelMode changes
  useEffect(() => {
    labelResolver.preloadTopNodeLabels(graphNodes, labelMode, 20)
  }, [graphNodes, labelMode])

  // Generate meaningful groups from sample data showing actual feature concepts
  const groups = React.useMemo(() => {
    // Group by semantic similarity (in real app, this would come from clustering algorithm)
    const semanticGroups = [
      {
        id: 'financial_analysis',
        name: 'Financial Analysis',
        members: graphNodes.filter(node => 
          node.clerp?.toLowerCase().includes('money') || 
          node.clerp?.toLowerCase().includes('analysis')
        )
      },
      {
        id: 'metadata_processing', 
        name: 'Metadata Processing',
        members: graphNodes.filter(node => 
          node.clerp?.toLowerCase().includes('metadata') ||
          node.clerp?.toLowerCase().includes('associative')
        )
      },
      {
        id: 'attention_mechanisms',
        name: 'Attention Mechanisms', 
        members: graphNodes.filter(node => 
          node.feature_type === 'attention' ||
          node.clerp?.toLowerCase().includes('attention')
        )
      },
      {
        id: 'output_logits',
        name: 'Output Generation',
        members: graphNodes.filter(node => 
          node.feature_type === 'logit' ||
          node.clerp?.toLowerCase().includes('output')
        )
      }
    ].filter(group => group.members.length > 0)
    
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

  // Sample supernode data for cluster view
  const supernodeData = {
    nodes: groups.map(group => ({
      id: group.id,
      size: group.size,
      layer: group.members[0]?.layer || 0,
      members: group.members.map(m => m.id)
    })),
    edges: [
      { source: groups[0]?.id || 'financial_analysis', target: groups[2]?.id || 'attention_mechanisms', weight: 0.7 },
      { source: groups[1]?.id || 'metadata_processing', target: groups[2]?.id || 'attention_mechanisms', weight: 0.4 },
      { source: groups[2]?.id || 'attention_mechanisms', target: groups[3]?.id || 'output_logits', weight: 0.8 }
    ].filter(edge => edge.source && edge.target)
  }

  // Analysis handlers
  const handleRunAnalysis = useCallback(async (params: AnalysisParams) => {
    setIsRunning(true)
    try {
      // Simulate analysis API call
      await new Promise(resolve => setTimeout(resolve, 2000))
      setAnalysisResults({ status: 'completed', params } as any)
    } catch (error) {
      console.error('Analysis failed:', error)
    } finally {
      setIsRunning(false)
    }
  }, [])

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
    // Preload labels for top nodes when switching to autointerp mode
    if (mode === 'autointerp' && graphNodes.length > 0) {
      // Batch resolve labels for top nodes
      graphNodes.slice(0, 50).forEach(node => {
        labelResolver.resolveLabel(node, { mode, useCache: true }).catch(console.error)
      })
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

  return (
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
            edges={parsedData.links.map(link => ({
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
              const group = groups.find(g => g.id === groupId)
              if (group) {
                setSelectedNodes(group.members.map(m => m.id))
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
              const nodeLabels = Object.fromEntries(
                Object.entries(labels).map(([key, value]) => [
                  key,
                  { text: value, source: 'imported' as const, confidence: 1.0 }
                ])
              )
              labelResolver.importLabels(nodeLabels)
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
                nodes: charlotteData.nodes,
                links: charlotteData.edges
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
            <SupernodeClusterView
              data={supernodeData}
              onNodeHover={(node: any) => setHoveredNode(node?.id || null)}
              onNodeClick={(node: any) => setClickedNode(node?.id || null)}
              onNeighborhoodIsolate={handleNeighborhoodIsolate}
              edgeOpacityThreshold={edgeOpacityThreshold}
              showLabels={showLabels}
              darkMode={darkMode}
            />
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
          links={parsedData.links}
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
  )
}
