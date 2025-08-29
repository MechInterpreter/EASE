// Interactive Controls - Search, tooltips, lasso select, and other interactions
import React, { useState, useCallback, useRef, useEffect } from 'react'
import { Search, Pin, Target, Square, Circle, Download, Upload, Tag } from 'lucide-react'
import type { GraphNode } from '../lib/graph-types'
import { labelResolver } from '../services/labels/labelResolver'
import type { LabelMode } from '../services/labels/autoInterp'

interface InteractiveControlsProps {
  nodes: GraphNode[]
  edges?: Array<{ source: string, target: string, weight: number }>
  groups?: Array<{ id: string, name?: string, members: GraphNode[], size: number }>
  onSearch?: (query: string, results: GraphNode[]) => void
  onLassoSelect?: (selectedNodes: GraphNode[]) => void
  onPinNodes?: (nodeIds: string[]) => void
  onExportLabels?: () => void
  onImportLabels?: (labels: Record<string, string>) => void
  onLabelModeChange?: (mode: LabelMode) => void
  onGroupClick?: (groupId: string) => void
  onEdgeClick?: (source: string, target: string) => void
  labelMode?: LabelMode
  darkMode?: boolean
}

interface LassoPoint {
  x: number
  y: number
}

export default function InteractiveControls({
  nodes,
  edges = [],
  groups = [],
  onSearch,
  onLassoSelect,
  onPinNodes,
  onExportLabels,
  onImportLabels,
  onLabelModeChange,
  onGroupClick,
  onEdgeClick,
  labelMode = 'autointerp',
  darkMode = false
}: InteractiveControlsProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<GraphNode[]>([])
  const [isLassoMode, setIsLassoMode] = useState(false)
  const [lassoPoints, setLassoPoints] = useState<LassoPoint[]>([])
  const [isDrawing, setIsDrawing] = useState(false)
  const [groupLabels, setGroupLabels] = useState<Map<string, string>>(new Map())
  const [topEdges, setTopEdges] = useState<Array<{ source: string, target: string, weight: number, sourceLabel: string, targetLabel: string }>>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Fuzzy search implementation with label support
  const performSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([])
      onSearch?.(query, [])
      return
    }

    const lowerQuery = query.toLowerCase()
    const results: GraphNode[] = []
    
    for (const node of nodes) {
      // Get display label for current mode
      const displayLabel = labelResolver.getDisplayLabel(node, labelMode)
      
      const searchText = [
        node.label,
        node.ppClerp,
        node.clerp,
        node.id,
        node.featureId,
        displayLabel,
        node.feature_type
      ].filter(Boolean).join(' ').toLowerCase()

      if (searchText.includes(lowerQuery)) {
        results.push(node)
      }
    }

    // Sort by relevance (exact matches first, then partial)
    results.sort((a, b) => {
      const aLabel = labelResolver.getDisplayLabel(a, labelMode).toLowerCase()
      const bLabel = labelResolver.getDisplayLabel(b, labelMode).toLowerCase()
      
      const aExact = aLabel === lowerQuery ? 1 : 0
      const bExact = bLabel === lowerQuery ? 1 : 0
      
      if (aExact !== bExact) return bExact - aExact
      
      const aStarts = aLabel.startsWith(lowerQuery) ? 1 : 0
      const bStarts = bLabel.startsWith(lowerQuery) ? 1 : 0
      
      return bStarts - aStarts
    })

    setSearchResults(results.slice(0, 50)) // Limit results
    onSearch?.(query, results)
  }, [nodes, onSearch, labelMode])

  // Handle search input
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value
    setSearchQuery(query)
    performSearch(query)
  }, [performSearch])

  // Generate group labels on mount and when labelMode changes
  useEffect(() => {
    const generateGroupLabels = async () => {
      const newGroupLabels = new Map<string, string>()
      for (const group of groups) {
        // Use the group name if available, otherwise generate from members
        const label = group.name || await labelResolver.getSupernodeLabelWithId(group.members, group.id, labelMode)
        newGroupLabels.set(group.id, label)
      }
      setGroupLabels(newGroupLabels)
    }
    
    if (groups.length > 0) {
      generateGroupLabels()
    }
  }, [groups, labelMode])

  // Generate top edges with labels
  useEffect(() => {
    const generateTopEdges = async () => {
      // Sort edges by weight and take top 10
      const sortedEdges = edges
        .slice()
        .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
        .slice(0, 10)
      
      const edgesWithLabels = await Promise.all(
        sortedEdges.map(async (edge) => {
          const sourceNode = nodes.find(n => n.id === edge.source)
          const targetNode = nodes.find(n => n.id === edge.target)
          
          const sourceLabel = sourceNode 
            ? labelResolver.getDisplayLabelWithId(sourceNode, labelMode)
            : edge.source
          const targetLabel = targetNode 
            ? labelResolver.getDisplayLabelWithId(targetNode, labelMode)
            : edge.target
          
          return {
            ...edge,
            sourceLabel,
            targetLabel
          }
        })
      )
      
      setTopEdges(edgesWithLabels)
    }
    
    if (edges.length > 0) {
      generateTopEdges()
    }
  }, [edges, nodes, labelMode])

  // Lasso selection logic
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!isLassoMode) return
    setIsDrawing(true)
    setLassoPoints([{ x: e.clientX, y: e.clientY }])
  }, [isLassoMode])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDrawing || !isLassoMode) return
    setLassoPoints(prev => [...prev, { x: e.clientX, y: e.clientY }])
  }, [isDrawing, isLassoMode])

  const handleMouseUp = useCallback(() => {
    if (!isDrawing || !isLassoMode) return
    setIsDrawing(false)
    
    // Find nodes inside lasso
    const selectedNodes = nodes.filter(node => {
      if (!node.pos) return false
      return isPointInPolygon({ x: node.pos[0], y: node.pos[1] }, lassoPoints)
    })
    
    onLassoSelect?.(selectedNodes)
    setLassoPoints([])
    setIsLassoMode(false)
  }, [isDrawing, isLassoMode, nodes, lassoPoints, onLassoSelect])

  // Point in polygon test
  const isPointInPolygon = useCallback((point: { x: number; y: number }, polygon: LassoPoint[]): boolean => {
    let inside = false
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      if (((polygon[i].y > point.y) !== (polygon[j].y > point.y)) &&
          (point.x < (polygon[j].x - polygon[i].x) * (point.y - polygon[i].y) / (polygon[j].y - polygon[i].y) + polygon[i].x)) {
        inside = !inside
      }
    }
    return inside
  }, [])

  // Export labels to JSON
  const handleExportLabels = useCallback(() => {
    const labels: Record<string, string> = {}
    nodes.forEach(node => {
      if (node.ppClerp || node.clerp) {
        labels[node.id] = node.ppClerp || node.clerp || node.label
      }
    })

    const blob = new Blob([JSON.stringify(labels, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'labels.json'
    a.click()
    URL.revokeObjectURL(url)

    onExportLabels?.()
  }, [nodes, onExportLabels])

  // Import labels from JSON
  const handleImportLabels = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const labels = JSON.parse(event.target?.result as string)
        onImportLabels?.(labels)
      } catch (error) {
        console.error('Failed to parse labels file:', error)
      }
    }
    reader.readAsText(file)
  }, [onImportLabels])

  const handleLabelModeChange = (mode: LabelMode) => {
    onLabelModeChange?.(mode)
    // Re-run search with new label mode
    if (searchQuery.trim()) {
      performSearch(searchQuery)
    }
  }

  return (
    <div className={`space-y-4 p-4 rounded-lg border ${
      darkMode 
        ? 'bg-gray-800 border-gray-700 text-white' 
        : 'bg-white border-gray-200 text-gray-900'
    }`}>
      {/* Labels Toggle Group */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Tag className="w-4 h-4" />
          Labels
        </div>
        <div className="flex gap-1">
          {(['native', 'autointerp', 'heuristic'] as LabelMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => handleLabelModeChange(mode)}
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
        <div className="text-xs text-gray-500">
          {labelMode === 'native' && 'Show original JSON labels only'}
          {labelMode === 'autointerp' && 'Fetch human-readable labels from Neuronpedia'}
          {labelMode === 'heuristic' && 'Generate labels from node properties'}
        </div>
      </div>

      {/* Search */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Search className="w-4 h-4" />
          Search Nodes
        </div>
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder="Search by label, ID, or type..."
            className={`w-full px-3 py-2 text-sm rounded border ${
              darkMode
                ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400'
                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'
            } focus:outline-none focus:ring-2 focus:ring-blue-500`}
          />
          {searchResults.length > 0 && (
            <div className={`absolute top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded border shadow-lg z-50 ${
              darkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200'
            }`}>
              {searchResults.map((node) => (
                <div
                  key={node.id}
                  className={`px-3 py-2 text-sm cursor-pointer ${
                    darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-50'
                  }`}
                  onClick={() => {
                    // Focus on this node (could emit event)
                    console.log('Focus node:', node.id)
                  }}
                >
                  <div className="font-medium">
                    {labelResolver.getDisplayLabel(node, labelMode)}
                  </div>
                  <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    {node.id} • {node.feature_type || 'unknown'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {searchResults.length > 0 && (
          <div className="text-xs text-gray-500">
            {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} found
          </div>
        )}
      </div>

      {/* Interactive Tools */}
      <div className="space-y-3">
        <label className="block text-sm font-semibold">Interactive Tools</label>
        
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setIsLassoMode(!isLassoMode)}
            className={`flex items-center gap-2 px-3 py-2 text-xs rounded-lg border transition-colors ${
              isLassoMode
                ? 'bg-blue-500 text-white border-blue-500'
                : darkMode
                  ? 'bg-gray-700 text-gray-300 border-gray-600 hover:bg-gray-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            <Circle className="w-3 h-3" />
            Lasso Select
          </button>

          <button
            onClick={() => onPinNodes?.(searchResults.map(n => n.id))}
            disabled={searchResults.length === 0}
            className={`flex items-center gap-2 px-3 py-2 text-xs rounded-lg border transition-colors ${
              searchResults.length === 0
                ? 'opacity-50 cursor-not-allowed'
                : ''
            } ${
              darkMode
                ? 'bg-gray-700 text-gray-300 border-gray-600 hover:bg-gray-600'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            <Pin className="w-3 h-3" />
            Pin Results
          </button>
        </div>
      </div>

      {/* Label Management */}
      <div className="space-y-3">
        <label className="block text-sm font-semibold">Label Management</label>
        
        <div className="grid grid-cols-1 gap-2">
          <button
            onClick={handleExportLabels}
            className={`flex items-center gap-2 px-3 py-2 text-xs rounded-lg border transition-colors ${
              darkMode
                ? 'bg-gray-700 text-gray-300 border-gray-600 hover:bg-gray-600'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            <Download className="w-3 h-3" />
            Export Labels JSON
          </button>

          <div className="relative">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleImportLabels}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className={`flex items-center gap-2 px-3 py-2 text-xs rounded-lg border transition-colors w-full ${
                darkMode
                  ? 'bg-gray-700 text-gray-300 border-gray-600 hover:bg-gray-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              <Upload className="w-3 h-3" />
              Import Labels JSON
            </button>
          </div>
        </div>
      </div>

      {/* Groups */}
      {groups.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Tag className="w-4 h-4" />
            Groups
          </div>
          <div className={`max-h-48 overflow-y-auto rounded border ${darkMode ? 'border-gray-600' : 'border-gray-300'}`}>
            {groups.slice(0, 20).map((group) => (
              <div
                key={group.id}
                className={`px-3 py-2 text-sm cursor-pointer border-b last:border-b-0 ${darkMode ? 'border-gray-600 hover:bg-gray-700' : 'border-gray-200 hover:bg-gray-50'}`}
                onClick={() => onGroupClick?.(group.id)}
              >
                <div className="font-medium text-xs">
                  {groupLabels.get(group.id) || group.name || group.id}
                </div>
                <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  {group.size} feature{group.size !== 1 ? 's' : ''}
                </div>
                <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'} space-y-1`}>
                  {group.members.slice(0, 3).map(member => (
                    <div key={member.id} className="truncate">
                      • {member.clerp || member.ppClerp || member.label || `Feature ${member.id}`}
                    </div>
                  ))}
                  {group.members.length > 3 && (
                    <div className="italic">
                      +{group.members.length - 3} more features...
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top Edges */}
      {topEdges.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Target className="w-4 h-4" />
            Top edges
          </div>
          <div className={`max-h-48 overflow-y-auto rounded border ${darkMode ? 'border-gray-600' : 'border-gray-300'}`}>
            {topEdges.map((edge, index) => (
              <div
                key={`${edge.source}-${edge.target}`}
                className={`px-3 py-2 text-sm cursor-pointer border-b last:border-b-0 ${darkMode ? 'border-gray-600 hover:bg-gray-700' : 'border-gray-200 hover:bg-gray-50'}`}
                onClick={() => onEdgeClick?.(edge.source, edge.target)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-xs truncate">
                      {edge.sourceLabel} → {edge.targetLabel}
                    </div>
                    <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                      w={edge.weight.toFixed(3)}
                    </div>
                  </div>
                  <div className={`text-xs font-mono ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    L{nodes.find(n => n.id === edge.source)?.layer || '?'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Instructions */}
      <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'} space-y-1`}>
        <div className="font-medium">Instructions:</div>
        <div>• Search supports fuzzy matching</div>
        <div>• Lasso: Click and drag to select nodes</div>
        <div>• Pin nodes to fix their positions</div>
        <div>• Export/import custom label mappings</div>
      </div>

      {/* Lasso overlay */}
      {isLassoMode && (
        <div
          className="fixed inset-0 z-50 cursor-crosshair"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        >
          {lassoPoints.length > 1 && (
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              <path
                d={`M ${lassoPoints.map(p => `${p.x},${p.y}`).join(' L ')}`}
                stroke="#3b82f6"
                strokeWidth="2"
                fill="rgba(59, 130, 246, 0.1)"
                strokeDasharray="5,5"
              />
            </svg>
          )}
        </div>
      )}
    </div>
  )
}
