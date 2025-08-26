// Export Utils - PNG/SVG export, shareable URLs, error handling
import React, { useRef, useCallback } from 'react'
import { Download, Share2, AlertCircle, CheckCircle } from 'lucide-react'

interface ExportUtilsProps {
  svgRef?: React.RefObject<SVGSVGElement>
  canvasRef?: React.RefObject<HTMLCanvasElement>
  graphState?: any
  darkMode?: boolean
  onError?: (error: string) => void
  onSuccess?: (message: string) => void
}

interface ShareableState {
  viewMode: string
  layout: string
  edgeOpacity: number
  showLabels: boolean
  neighborHops: number
  darkMode: boolean
  searchQuery: string
  pinnedNodes: string[]
  selectedNodes: string[]
  analysisParams: any
}

export default function ExportUtils({
  svgRef,
  canvasRef,
  graphState,
  darkMode = false,
  onError,
  onSuccess
}: ExportUtilsProps) {

  // Export as PNG
  const exportPNG = useCallback(async () => {
    try {
      const canvas = canvasRef?.current
      const svg = svgRef?.current
      
      if (!canvas && !svg) {
        onError?.('No canvas or SVG element found for export')
        return
      }

      let exportCanvas: HTMLCanvasElement

      if (canvas) {
        exportCanvas = canvas
      } else if (svg) {
        // Convert SVG to canvas
        exportCanvas = document.createElement('canvas')
        const ctx = exportCanvas.getContext('2d')
        if (!ctx) throw new Error('Could not get canvas context')

        const svgData = new XMLSerializer().serializeToString(svg)
        const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
        const svgUrl = URL.createObjectURL(svgBlob)

        const img = new Image()
        await new Promise((resolve, reject) => {
          img.onload = resolve
          img.onerror = reject
          img.src = svgUrl
        })

        exportCanvas.width = img.width
        exportCanvas.height = img.height
        ctx.drawImage(img, 0, 0)
        URL.revokeObjectURL(svgUrl)
      } else {
        throw new Error('No valid element for export')
      }

      // Download PNG
      exportCanvas.toBlob((blob) => {
        if (!blob) {
          onError?.('Failed to create PNG blob')
          return
        }

        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.download = `ease-graph-${new Date().toISOString().slice(0, 10)}.png`
        link.href = url
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)

        onSuccess?.('PNG exported successfully')
      }, 'image/png')

    } catch (error) {
      onError?.(`PNG export failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }, [canvasRef, svgRef, onError, onSuccess])

  // Export as SVG
  const exportSVG = useCallback(() => {
    try {
      const svg = svgRef?.current
      if (!svg) {
        onError?.('No SVG element found for export')
        return
      }

      const svgData = new XMLSerializer().serializeToString(svg)
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
      const svgUrl = URL.createObjectURL(svgBlob)

      const link = document.createElement('a')
      link.download = `ease-graph-${new Date().toISOString().slice(0, 10)}.svg`
      link.href = svgUrl
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(svgUrl)

      onSuccess?.('SVG exported successfully')

    } catch (error) {
      onError?.(`SVG export failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }, [svgRef, onError, onSuccess])

  // Generate shareable URL
  const generateShareableURL = useCallback(() => {
    try {
      if (!graphState) {
        onError?.('No graph state available for sharing')
        return
      }

      const shareableState: ShareableState = {
        viewMode: graphState.viewMode || 'attribution',
        layout: graphState.layout || 'layered',
        edgeOpacity: graphState.edgeOpacity || 0.1,
        showLabels: graphState.showLabels ?? true,
        neighborHops: graphState.neighborHops || 2,
        darkMode: graphState.darkMode || false,
        searchQuery: graphState.searchQuery || '',
        pinnedNodes: graphState.pinnedNodes || [],
        selectedNodes: graphState.selectedNodes || [],
        analysisParams: graphState.analysisParams || {}
      }

      // Compress and encode state
      const stateString = JSON.stringify(shareableState)
      const encodedState = btoa(encodeURIComponent(stateString))
      
      const baseUrl = window.location.origin + window.location.pathname
      const shareableUrl = `${baseUrl}?state=${encodedState}`

      // Copy to clipboard
      navigator.clipboard.writeText(shareableUrl).then(() => {
        onSuccess?.('Shareable URL copied to clipboard')
      }).catch(() => {
        // Fallback for older browsers
        const textArea = document.createElement('textarea')
        textArea.value = shareableUrl
        document.body.appendChild(textArea)
        textArea.select()
        document.execCommand('copy')
        document.body.removeChild(textArea)
        onSuccess?.('Shareable URL copied to clipboard')
      })

    } catch (error) {
      onError?.(`Failed to generate shareable URL: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }, [graphState, onError, onSuccess])

  // Load state from URL
  const loadStateFromURL = useCallback(() => {
    try {
      const urlParams = new URLSearchParams(window.location.search)
      const encodedState = urlParams.get('state')
      
      if (!encodedState) return null

      const stateString = decodeURIComponent(atob(encodedState))
      const state = JSON.parse(stateString) as ShareableState
      
      return state

    } catch (error) {
      onError?.(`Failed to load state from URL: ${error instanceof Error ? error.message : 'Invalid URL state'}`)
      return null
    }
  }, [onError])

  // Export graph data as JSON
  const exportGraphData = useCallback(() => {
    try {
      if (!graphState?.nodes || !graphState?.links) {
        onError?.('No graph data available for export')
        return
      }

      const exportData = {
        metadata: {
          exportTime: new Date().toISOString(),
          version: '1.0.0',
          source: 'EASE Graph Visualization'
        },
        nodes: graphState.nodes,
        links: graphState.links,
        state: graphState
      }

      const dataString = JSON.stringify(exportData, null, 2)
      const dataBlob = new Blob([dataString], { type: 'application/json' })
      const dataUrl = URL.createObjectURL(dataBlob)

      const link = document.createElement('a')
      link.download = `ease-graph-data-${new Date().toISOString().slice(0, 10)}.json`
      link.href = dataUrl
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(dataUrl)

      onSuccess?.('Graph data exported successfully')

    } catch (error) {
      onError?.(`Graph data export failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }, [graphState, onError, onSuccess])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className={`text-sm font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
          Export & Share
        </h3>
      </div>

      {/* Export Buttons */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={exportPNG}
          className={`flex items-center justify-center px-3 py-2 text-xs rounded-lg transition-colors ${
            darkMode
              ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
          title="Export as PNG image"
        >
          <Download className="w-3 h-3 mr-1" />
          PNG
        </button>

        <button
          onClick={exportSVG}
          className={`flex items-center justify-center px-3 py-2 text-xs rounded-lg transition-colors ${
            darkMode
              ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
          title="Export as SVG vector"
        >
          <Download className="w-3 h-3 mr-1" />
          SVG
        </button>

        <button
          onClick={generateShareableURL}
          className={`flex items-center justify-center px-3 py-2 text-xs rounded-lg transition-colors ${
            darkMode
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-blue-500 text-white hover:bg-blue-600'
          }`}
          title="Generate shareable URL"
        >
          <Share2 className="w-3 h-3 mr-1" />
          Share
        </button>

        <button
          onClick={exportGraphData}
          className={`flex items-center justify-center px-3 py-2 text-xs rounded-lg transition-colors ${
            darkMode
              ? 'bg-green-600 text-white hover:bg-green-700'
              : 'bg-green-500 text-white hover:bg-green-600'
          }`}
          title="Export graph data as JSON"
        >
          <Download className="w-3 h-3 mr-1" />
          Data
        </button>
      </div>

      {/* Export Options */}
      <div className="space-y-3 pt-3 border-t border-gray-200 dark:border-gray-600">
        <label className={`block text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
          Export Options
        </label>
        
        <div className="space-y-2">
          <label className="flex items-center">
            <input
              type="checkbox"
              defaultChecked={true}
              className="mr-2 rounded"
            />
            <span className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              Include labels
            </span>
          </label>
          
          <label className="flex items-center">
            <input
              type="checkbox"
              defaultChecked={false}
              className="mr-2 rounded"
            />
            <span className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              High resolution (2x)
            </span>
          </label>
          
          <label className="flex items-center">
            <input
              type="checkbox"
              defaultChecked={true}
              className="mr-2 rounded"
            />
            <span className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              Include metadata
            </span>
          </label>
        </div>
      </div>

      {/* Format Info */}
      <div className={`text-xs pt-3 border-t border-gray-200 dark:border-gray-600 ${
        darkMode ? 'text-gray-400' : 'text-gray-600'
      }`}>
        <div className="space-y-1">
          <div>• <strong>PNG:</strong> Raster image, good for presentations</div>
          <div>• <strong>SVG:</strong> Vector format, scalable and editable</div>
          <div>• <strong>Share:</strong> URL with current view state</div>
          <div>• <strong>Data:</strong> Raw graph data as JSON</div>
        </div>
      </div>
    </div>
  )
}

// Error Toast Component
export function ErrorToast({ 
  message, 
  onClose, 
  darkMode = false 
}: { 
  message: string
  onClose: () => void
  darkMode?: boolean 
}) {
  return (
    <div className={`fixed top-4 right-4 z-50 flex items-center px-4 py-3 rounded-lg shadow-lg ${
      darkMode ? 'bg-red-800 text-red-100' : 'bg-red-100 text-red-800'
    }`}>
      <AlertCircle className="w-4 h-4 mr-2 flex-shrink-0" />
      <span className="text-sm">{message}</span>
      <button
        onClick={onClose}
        className={`ml-3 text-lg leading-none ${
          darkMode ? 'text-red-300 hover:text-red-100' : 'text-red-600 hover:text-red-800'
        }`}
      >
        ×
      </button>
    </div>
  )
}

// Success Toast Component
export function SuccessToast({ 
  message, 
  onClose, 
  darkMode = false 
}: { 
  message: string
  onClose: () => void
  darkMode?: boolean 
}) {
  return (
    <div className={`fixed top-4 right-4 z-50 flex items-center px-4 py-3 rounded-lg shadow-lg ${
      darkMode ? 'bg-green-800 text-green-100' : 'bg-green-100 text-green-800'
    }`}>
      <CheckCircle className="w-4 h-4 mr-2 flex-shrink-0" />
      <span className="text-sm">{message}</span>
      <button
        onClick={onClose}
        className={`ml-3 text-lg leading-none ${
          darkMode ? 'text-green-300 hover:text-green-100' : 'text-green-600 hover:text-green-800'
        }`}
      >
        ×
      </button>
    </div>
  )
}
