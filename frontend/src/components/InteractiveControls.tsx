// Interactive Controls - Search, tooltips, lasso select, and other interactions
import React, { useState, useCallback, useRef, useEffect } from 'react'
import { Search, Pin, Target, Square, Circle, Download, Upload } from 'lucide-react'
import type { GraphNode } from '../lib/graph-types'

interface InteractiveControlsProps {
  nodes: GraphNode[]
  onSearch?: (query: string, results: GraphNode[]) => void
  onLassoSelect?: (selectedNodes: GraphNode[]) => void
  onPinNodes?: (nodeIds: string[]) => void
  onExportLabels?: () => void
  onImportLabels?: (labels: Record<string, string>) => void
  darkMode?: boolean
}

interface LassoPoint {
  x: number
  y: number
}

export default function InteractiveControls({
  nodes,
  onSearch,
  onLassoSelect,
  onPinNodes,
  onExportLabels,
  onImportLabels,
  darkMode = false
}: InteractiveControlsProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<GraphNode[]>([])
  const [isLassoMode, setIsLassoMode] = useState(false)
  const [lassoPoints, setLassoPoints] = useState<LassoPoint[]>([])
  const [isDrawing, setIsDrawing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Fuzzy search implementation
  const performSearch = useCallback((query: string) => {
    if (!query.trim()) {
      setSearchResults([])
      onSearch?.(query, [])
      return
    }

    const lowerQuery = query.toLowerCase()
    const results = nodes.filter(node => {
      const searchText = [
        node.label,
        node.ppClerp,
        node.clerp,
        node.id,
        node.featureId,
        node.feature_type
      ].filter(Boolean).join(' ').toLowerCase()

      // Simple fuzzy matching
      const words = lowerQuery.split(' ')
      return words.every(word => searchText.includes(word))
    }).slice(0, 20) // Limit results

    setSearchResults(results)
    onSearch?.(query, results)
  }, [nodes, onSearch])

  // Handle search input
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value
    setSearchQuery(query)
    performSearch(query)
  }, [performSearch])

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

  return (
    <div className={`space-y-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
      {/* Search */}
      <div className="space-y-2">
        <label className="block text-sm font-semibold">Search Nodes</label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder="Search by ID, label, or type..."
            className={`w-full pl-10 pr-4 py-2 text-sm border rounded-lg ${
              darkMode 
                ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' 
                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'
            } focus:ring-2 focus:ring-blue-500 focus:border-transparent`}
          />
        </div>
        
        {searchResults.length > 0 && (
          <div className={`max-h-40 overflow-y-auto border rounded-lg ${
            darkMode ? 'border-gray-600 bg-gray-700' : 'border-gray-200 bg-white'
          }`}>
            {searchResults.map(node => (
              <div
                key={node.id}
                className={`px-3 py-2 text-xs border-b last:border-b-0 cursor-pointer hover:${
                  darkMode ? 'bg-gray-600' : 'bg-gray-50'
                } ${darkMode ? 'border-gray-600' : 'border-gray-200'}`}
                onClick={() => {
                  // Scroll to node or highlight it
                  console.log('Navigate to node:', node.id)
                }}
              >
                <div className="font-medium">{node.ppClerp || node.clerp || node.label}</div>
                <div className="text-gray-500">
                  {node.id} • Layer {node.layer} • {node.feature_type}
                </div>
              </div>
            ))}
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
