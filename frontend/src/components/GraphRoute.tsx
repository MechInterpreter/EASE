import React, { useState, useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import GraphVisualization from './GraphVisualization'
import InteractiveControls from './InteractiveControls'
import type { 
  VisualizationType, 
  NeuronpediaData, 
  SupernodeData, 
  GraphNode, 
  GraphConfig 
} from '../lib/graph-types'
import type { LayoutType } from '../types'
import { labelResolver } from '../services/labels/labelResolver'
import type { LabelMode } from '../services/labels/autoInterp'

// Sample data for testing with enhanced labels
const sampleNeuronpediaData: NeuronpediaData = {
  nodes: [
    { feature: 0, layer: 0, feature_type: 'neuron', label: 'Input embedding', id: 'feature|0|0', clerp: 'Token embedding layer', activation: 0.8, influence: 0.2 },
    { feature: 1, layer: 1, feature_type: 'attention', label: 'Self-attention head', id: 'feature|1|123', clerp: 'Attention mechanism', activation: 1.2, influence: 0.9 },
    { feature: 2, layer: 1, feature_type: 'mlp', label: 'MLP neuron', id: 'feature|1|456', clerp: 'MLP processing', activation: 0.6, influence: 0.4 },
    { feature: 3, layer: 2, feature_type: 'attention', label: 'Cross-attention', id: 'feature|2|789', clerp: 'Cross attention head', activation: 1.5, influence: 1.1 },
    { feature: 4, layer: 2, feature_type: 'logit', label: 'Output logit', id: 'feature|2|999', clerp: 'Output generation', activation: 2.1, influence: 1.8 }
  ],
  edges: [
    { source: 0, target: 1, weight: 0.8 },
    { source: 0, target: 2, weight: -0.3 },
    { source: 1, target: 3, weight: 0.6 },
    { source: 2, target: 3, weight: -0.4 },
    { source: 3, target: 4, weight: 0.9 }
  ],
  metadata: {
    model: 'gpt2-small',
    scan: 'attribution',
    layers: 3
  }
}

const sampleSupernodeData: SupernodeData = {
  nodes: [
    { id: 'embedding_group', size: 15, layer: 0, members: ['feature|0|0', 'feature|0|1', 'feature|0|2'], name: 'Embedding Features' },
    { id: 'attention_group', size: 8, layer: 1, members: ['feature|1|123', 'feature|1|124'], name: 'Attention Mechanisms' },
    { id: 'mlp_group', size: 12, layer: 1, members: ['feature|1|456', 'feature|1|457', 'feature|1|458'], name: 'MLP Processing' },
    { id: 'output_group', size: 6, layer: 2, members: ['feature|2|999'], name: 'Output Generation' }
  ],
  edges: [
    { source: 'embedding_group', target: 'attention_group', weight: 0.7 },
    { source: 'embedding_group', target: 'mlp_group', weight: -0.2 },
    { source: 'attention_group', target: 'output_group', weight: 0.5 },
    { source: 'mlp_group', target: 'output_group', weight: 0.3 }
  ]
}

export default function GraphRoute() {
  const [visualizationType, setVisualizationType] = useState<VisualizationType>('attribution')
  const [edgeOpacityThreshold, setEdgeOpacityThreshold] = useState(0.1)
  const [layout, setLayout] = useState<LayoutType>('force')
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null)
  const [clickedNode, setClickedNode] = useState<GraphNode | null>(null)
  const [labelMode, setLabelMode] = useState<LabelMode>('autointerp')
  const [darkMode, setDarkMode] = useState(false)
  
  // Convert sample data to GraphNode format for labeling
  const graphNodes: GraphNode[] = sampleNeuronpediaData.nodes.map(node => ({
    ...node,
    id: node.id || `${node.feature}_${node.layer}`,
    featureId: `${node.layer}_${node.feature}`
  }))
  
  // Generate groups for InteractiveControls
  const groups = React.useMemo(() => {
    const layerGroups = new Map<string, GraphNode[]>()
    graphNodes.forEach(node => {
      const layer = node.layer?.toString() || 'unknown'
      if (!layerGroups.has(layer)) {
        layerGroups.set(layer, [])
      }
      layerGroups.get(layer)!.push(node)
    })
    
    return Array.from(layerGroups.entries()).map(([layer, members]) => ({
      id: `layer_${layer}`,
      name: `Layer ${layer} Features`,
      members,
      size: members.length
    }))
  }, [graphNodes])
  
  // Preload labels
  useEffect(() => {
    labelResolver.preloadTopNodeLabels(graphNodes, labelMode, 10)
  }, [graphNodes, labelMode])

  const graphConfig: GraphConfig = {
    width: 800,
    height: 600,
    margin: { left: 40, right: 40, top: 40, bottom: 40 },
    nodeWidth: 75,
    nodeHeight: 25,
    edgeOpacityThreshold,
    layout: layout as 'force' | 'layered'
  }

  const currentData = visualizationType === 'attribution' ? sampleNeuronpediaData : sampleSupernodeData

  const handleNodeHover = useCallback((node: GraphNode | null) => {
    setHoveredNode(node)
  }, [])

  const handleNodeClick = useCallback((node: GraphNode | null) => {
    setClickedNode(node)
  }, [])

  return (
    <div className={`flex h-screen ${darkMode ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-900'}`}>
      {/* Controls Panel */}
      <div className={`w-80 border-r overflow-y-auto ${
        darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
      }`}>
        <div className={`p-4 border-b ${
          darkMode ? 'border-gray-700' : 'border-gray-200'
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <h1 className={`text-xl font-bold ${
                darkMode ? 'text-white' : 'text-gray-900'
              }`}>Graph Visualizations</h1>
              <p className={`text-sm mt-1 ${
                darkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>
                D3-based visualizations with Neuronpedia patterns
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setDarkMode(!darkMode)}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  darkMode
                    ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                {darkMode ? '☀️' : '🌙'}
              </button>
              <Link 
                to="/" 
                className="px-3 py-1 text-sm bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
              >
                ← EASE
              </Link>
            </div>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {/* Label Mode Selector */}
          <div>
            <label className={`block text-sm font-semibold mb-2 ${
              darkMode ? 'text-gray-300' : 'text-gray-700'
            }`}>
              Label Mode
            </label>
            <div className="flex gap-1">
              {(['native', 'autointerp', 'heuristic'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setLabelMode(mode)}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                    labelMode === mode
                      ? darkMode
                        ? 'bg-blue-600 text-white'
                        : 'bg-blue-500 text-white'
                      : darkMode
                        ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {mode === 'native' ? 'Native' : mode === 'autointerp' ? 'Autointerp' : 'Heuristic'}
                </button>
              ))}
            </div>
          </div>
          
          {/* Visualization Type Selector */}
          <div>
            <label className={`block text-sm font-semibold mb-2 ${
              darkMode ? 'text-gray-300' : 'text-gray-700'
            }`}>
              Visualization Type
            </label>
            <div className="space-y-2">
              <label className="flex items-center">
                <input
                  type="radio"
                  name="vizType"
                  value="attribution"
                  checked={visualizationType === 'attribution'}
                  onChange={(e) => setVisualizationType(e.target.value as VisualizationType)}
                  className="mr-2"
                />
                <span className="text-sm">Attribution Graph (Neuronpedia JSON)</span>
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  name="vizType"
                  value="supernode"
                  checked={visualizationType === 'supernode'}
                  onChange={(e) => setVisualizationType(e.target.value as VisualizationType)}
                  className="mr-2"
                />
                <span className="text-sm">Force/Cluster View (Supernodes)</span>
              </label>
            </div>
          </div>

          {/* Layout Control */}
          <div>
            <label className={`block text-sm font-semibold mb-2 ${
              darkMode ? 'text-gray-300' : 'text-gray-700'
            }`}>
              Layout
            </label>
            <select
              value={layout}
              onChange={(e) => setLayout(e.target.value as LayoutType)}
              className={`w-full border rounded px-3 py-2 text-sm ${
                darkMode
                  ? 'bg-gray-700 border-gray-600 text-white'
                  : 'bg-white border-gray-300 text-gray-900'
              }`}
            >
              <option value="force">Force-directed</option>
              <option value="layered">Layered</option>
            </select>
          </div>

          {/* Edge Opacity Threshold */}
          <div>
            <label className={`block text-sm font-semibold mb-2 ${
              darkMode ? 'text-gray-300' : 'text-gray-700'
            }`}>
              Edge Opacity Threshold
            </label>
            <div className="flex items-center space-x-2">
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={edgeOpacityThreshold}
                onChange={(e) => setEdgeOpacityThreshold(parseFloat(e.target.value))}
                className="flex-1"
              />
              <span className={`text-sm w-12 ${
                darkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>
                {edgeOpacityThreshold.toFixed(2)}
              </span>
            </div>
          </div>
          
          {/* Interactive Controls */}
          <InteractiveControls
            nodes={graphNodes}
            edges={sampleNeuronpediaData.edges.map(edge => ({
              source: edge.source.toString(),
              target: edge.target.toString(),
              weight: edge.weight
            }))}
            groups={groups}
            onSearch={(query, results) => {
              console.log('Search:', query, results.length, 'results')
            }}
            onLassoSelect={(nodes) => {
              console.log('Lasso selected:', nodes.length, 'nodes')
            }}
            onPinNodes={(nodeIds) => {
              console.log('Pinned nodes:', nodeIds)
            }}
            onGroupClick={(groupId) => {
              console.log('Group clicked:', groupId)
            }}
            onEdgeClick={(source, target) => {
              console.log('Edge clicked:', source, '->', target)
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
            }}
            onImportLabels={(labels) => {
              const nodeLabels = Object.fromEntries(
                Object.entries(labels).map(([key, value]) => [
                  key,
                  { text: value, source: 'imported' as const, confidence: 1.0 }
                ])
              )
              labelResolver.importLabels(nodeLabels)
            }}
            onLabelModeChange={setLabelMode}
            labelMode={labelMode}
            darkMode={darkMode}
          />

          {/* Node Information */}
          <div className={`border-t pt-4 ${
            darkMode ? 'border-gray-700' : 'border-gray-200'
          }`}>
            <h3 className={`text-sm font-semibold mb-2 ${
              darkMode ? 'text-gray-300' : 'text-gray-700'
            }`}>Node Information</h3>
            
            {hoveredNode && (
              <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-2">
                <h4 className="text-xs font-semibold text-blue-800 mb-1">Hovered</h4>
                <p className="text-xs text-blue-700">{hoveredNode.label}</p>
                {hoveredNode.layer !== undefined && (
                  <p className="text-xs text-blue-600">Layer: {hoveredNode.layer}</p>
                )}
                {hoveredNode.size !== undefined && (
                  <p className="text-xs text-blue-600">Size: {hoveredNode.size}</p>
                )}
              </div>
            )}

            {clickedNode && (
              <div className="bg-green-50 border border-green-200 rounded p-3">
                <h4 className="text-xs font-semibold text-green-800 mb-1">Selected</h4>
                <p className="text-xs text-green-700">{clickedNode.label}</p>
                {clickedNode.layer !== undefined && (
                  <p className="text-xs text-green-600">Layer: {clickedNode.layer}</p>
                )}
                {clickedNode.size !== undefined && (
                  <p className="text-xs text-green-600">Size: {clickedNode.size}</p>
                )}
                {clickedNode.members && (
                  <p className="text-xs text-green-600">
                    Members: {clickedNode.members.length}
                  </p>
                )}
              </div>
            )}

            {!hoveredNode && !clickedNode && (
              <p className="text-xs text-gray-500">
                Hover or click nodes to see details
              </p>
            )}
          </div>

          {/* Instructions */}
          <div className={`border-t pt-4 ${
            darkMode ? 'border-gray-700' : 'border-gray-200'
          }`}>
            <h3 className={`text-sm font-semibold mb-2 ${
              darkMode ? 'text-gray-300' : 'text-gray-700'
            }`}>Instructions</h3>
            <ul className={`text-xs space-y-1 ${
              darkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>
              <li>• Drag nodes to reposition</li>
              <li>• Hover for node details</li>
              <li>• Click to select and highlight connections</li>
              <li>• Adjust edge threshold to filter weak connections</li>
              <li>• Switch between force and layered layouts</li>
              <li>• Toggle label modes to see different label types</li>
              <li>• Use Groups panel to see semantic clusters</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Visualization Panel */}
      <div className="flex-1 flex flex-col">
        <div className={`border-b px-4 py-3 ${
          darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
        }`}>
          <h2 className={`text-lg font-semibold ${
            darkMode ? 'text-white' : 'text-gray-900'
          }`}>
            {visualizationType === 'attribution' ? 'Attribution Graph' : 'Supernode Clusters'}
          </h2>
          <p className={`text-sm ${
            darkMode ? 'text-gray-400' : 'text-gray-600'
          }`}>
            {visualizationType === 'attribution' 
              ? 'Neuronpedia-style attribution visualization with human-readable labels and autointerp support'
              : 'Force-directed clustering of automated supernodes with semantic grouping'
            }
          </p>
        </div>

        <div className={`flex-1 ${
          darkMode ? 'bg-gray-900' : 'bg-gray-100'
        }`}>
          <GraphVisualization
            data={currentData}
            type={visualizationType}
            config={graphConfig}
            onNodeHover={handleNodeHover}
            onNodeClick={handleNodeClick}
            labelMode={labelMode}
            darkMode={darkMode}
          />
        </div>
      </div>
    </div>
  )
}
