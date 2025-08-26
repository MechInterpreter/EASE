import React, { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import GraphVisualization from './GraphVisualization'
import type { 
  VisualizationType, 
  NeuronpediaData, 
  SupernodeData, 
  GraphNode, 
  GraphConfig 
} from '../lib/graph-types'
import type { LayoutType } from '../types'

// Sample data for testing
const sampleNeuronpediaData: NeuronpediaData = {
  nodes: [
    { feature: 0, layer: 0, feature_type: 'neuron', label: 'Input embedding' },
    { feature: 1, layer: 1, feature_type: 'attention', label: 'Self-attention head' },
    { feature: 2, layer: 1, feature_type: 'mlp', label: 'MLP neuron' },
    { feature: 3, layer: 2, feature_type: 'attention', label: 'Cross-attention' },
    { feature: 4, layer: 2, feature_type: 'logit', label: 'Output logit' }
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
    { id: 'supernode-1', size: 15, layer: 0, members: ['n1', 'n2', 'n3'] },
    { id: 'supernode-2', size: 8, layer: 1, members: ['n4', 'n5'] },
    { id: 'supernode-3', size: 12, layer: 1, members: ['n6', 'n7', 'n8'] },
    { id: 'supernode-4', size: 6, layer: 2, members: ['n9'] }
  ],
  edges: [
    { source: 'supernode-1', target: 'supernode-2', weight: 0.7 },
    { source: 'supernode-1', target: 'supernode-3', weight: -0.2 },
    { source: 'supernode-2', target: 'supernode-4', weight: 0.5 },
    { source: 'supernode-3', target: 'supernode-4', weight: 0.3 }
  ]
}

export default function GraphRoute() {
  const [visualizationType, setVisualizationType] = useState<VisualizationType>('attribution')
  const [edgeOpacityThreshold, setEdgeOpacityThreshold] = useState(0.1)
  const [layout, setLayout] = useState<LayoutType>('force')
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null)
  const [clickedNode, setClickedNode] = useState<GraphNode | null>(null)

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
    <div className="flex h-screen bg-gray-50">
      {/* Controls Panel */}
      <div className="w-80 bg-white border-r border-gray-200 overflow-y-auto">
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-gray-900">Graph Visualizations</h1>
              <p className="text-sm text-gray-600 mt-1">
                D3-based visualizations with Neuronpedia patterns
              </p>
            </div>
            <Link 
              to="/" 
              className="px-3 py-1 text-sm bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
            >
              ← EASE
            </Link>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {/* Visualization Type Selector */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
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
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Layout
            </label>
            <select
              value={layout}
              onChange={(e) => setLayout(e.target.value as LayoutType)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
            >
              <option value="force">Force-directed</option>
              <option value="layered">Layered</option>
            </select>
          </div>

          {/* Edge Opacity Threshold */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
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
              <span className="text-sm text-gray-600 w-12">
                {edgeOpacityThreshold.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Node Information */}
          <div className="border-t border-gray-200 pt-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Node Information</h3>
            
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
          <div className="border-t border-gray-200 pt-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Instructions</h3>
            <ul className="text-xs text-gray-600 space-y-1">
              <li>• Drag nodes to reposition</li>
              <li>• Hover for node details</li>
              <li>• Click to select and highlight connections</li>
              <li>• Adjust edge threshold to filter weak connections</li>
              <li>• Switch between force and layered layouts</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Visualization Panel */}
      <div className="flex-1 flex flex-col">
        <div className="bg-white border-b border-gray-200 px-4 py-3">
          <h2 className="text-lg font-semibold text-gray-900">
            {visualizationType === 'attribution' ? 'Attribution Graph' : 'Supernode Clusters'}
          </h2>
          <p className="text-sm text-gray-600">
            {visualizationType === 'attribution' 
              ? 'Neuronpedia-style attribution visualization with human-readable labels'
              : 'Force-directed clustering of automated supernodes'
            }
          </p>
        </div>

        <div className="flex-1 bg-gray-100">
          <GraphVisualization
            data={currentData}
            type={visualizationType}
            config={graphConfig}
            onNodeHover={handleNodeHover}
            onNodeClick={handleNodeClick}
          />
        </div>
      </div>
    </div>
  )
}
