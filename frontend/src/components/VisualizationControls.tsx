// Visualization Controls - layout, edge-opacity, labels, neighbors N, dark mode, Reset
import React, { useState, useCallback } from 'react'
import { RotateCcw, Eye, EyeOff, Moon, Sun, Maximize, Target } from 'lucide-react'

interface VisualizationControlsProps {
  layout: 'force' | 'layered'
  edgeOpacityThreshold: number
  showLabels: boolean
  neighborsN: number
  darkMode: boolean
  onLayoutChange?: (layout: 'force' | 'layered') => void
  onEdgeOpacityChange?: (threshold: number) => void
  onLabelsToggle?: (show: boolean) => void
  onNeighborsChange?: (n: number) => void
  onDarkModeToggle?: (dark: boolean) => void
  onReset?: () => void
  onFitToView?: () => void
}

export default function VisualizationControls({
  layout,
  edgeOpacityThreshold,
  showLabels,
  neighborsN,
  darkMode,
  onLayoutChange,
  onEdgeOpacityChange,
  onLabelsToggle,
  onNeighborsChange,
  onDarkModeToggle,
  onReset,
  onFitToView
}: VisualizationControlsProps) {
  const [isExpanded, setIsExpanded] = useState(true)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Visualization</h3>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-gray-500 hover:text-gray-700"
        >
          {isExpanded ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>

      {isExpanded && (
        <>
          {/* Layout Control */}
          <div>
            <label className="block text-xs font-medium mb-2">Layout</label>
            <div className="grid grid-cols-2 gap-1">
              <button
                onClick={() => onLayoutChange?.('force')}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  layout === 'force'
                    ? 'bg-blue-500 text-white'
                    : darkMode
                      ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                Force
              </button>
              <button
                onClick={() => onLayoutChange?.('layered')}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  layout === 'layered'
                    ? 'bg-blue-500 text-white'
                    : darkMode
                      ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                Layered
              </button>
            </div>
          </div>

          {/* Edge Opacity Threshold */}
          <div>
            <label className="block text-xs font-medium mb-1">
              Edge Opacity Threshold
            </label>
            <div className="flex items-center space-x-2">
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={edgeOpacityThreshold}
                onChange={(e) => onEdgeOpacityChange?.(parseFloat(e.target.value))}
                className="flex-1"
              />
              <span className="text-xs w-12 text-right">
                {edgeOpacityThreshold.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Neighbors N */}
          <div>
            <label className="block text-xs font-medium mb-1">
              Neighborhood Hops (N)
            </label>
            <div className="flex items-center space-x-2">
              <input
                type="range"
                min="1"
                max="5"
                step="1"
                value={neighborsN}
                onChange={(e) => onNeighborsChange?.(parseInt(e.target.value))}
                className="flex-1"
              />
              <span className="text-xs w-8 text-right">{neighborsN}</span>
            </div>
          </div>

          {/* Toggle Controls */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium">Show Labels</label>
              <button
                onClick={() => onLabelsToggle?.(!showLabels)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  showLabels ? 'bg-blue-500' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                    showLabels ? 'translate-x-5' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <label className="text-xs font-medium">Dark Mode</label>
              <button
                onClick={() => onDarkModeToggle?.(!darkMode)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  darkMode ? 'bg-blue-500' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                    darkMode ? 'translate-x-5' : 'translate-x-1'
                  }`}
                />
                {darkMode ? (
                  <Moon className="absolute left-1 w-2 h-2 text-white" />
                ) : (
                  <Sun className="absolute right-1 w-2 h-2 text-gray-600" />
                )}
              </button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 pt-3 border-t border-gray-200 dark:border-gray-600">
            <button
              onClick={onFitToView}
              className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs rounded transition-colors ${
                darkMode
                  ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              <Maximize className="w-3 h-3" />
              Fit
            </button>

            <button
              onClick={onReset}
              className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs rounded transition-colors ${
                darkMode
                  ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              <RotateCcw className="w-3 h-3" />
              Reset
            </button>
          </div>

          {/* Quick Presets */}
          <div className="space-y-2">
            <label className="block text-xs font-medium">Quick Presets</label>
            <div className="grid grid-cols-2 gap-1">
              <button
                onClick={() => {
                  onEdgeOpacityChange?.(0.05)
                  onNeighborsChange?.(3)
                  onLabelsToggle?.(true)
                }}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  darkMode
                    ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                Detailed
              </button>
              <button
                onClick={() => {
                  onEdgeOpacityChange?.(0.3)
                  onNeighborsChange?.(1)
                  onLabelsToggle?.(false)
                }}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  darkMode
                    ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                Clean
              </button>
            </div>
          </div>

          {/* Performance Info */}
          <div className={`text-xs pt-2 border-t border-gray-200 dark:border-gray-600 ${
            darkMode ? 'text-gray-400' : 'text-gray-600'
          }`}>
            <div className="font-medium mb-1">Tips:</div>
            <div>• Higher threshold = fewer edges</div>
            <div>• Lower N = faster neighborhood isolation</div>
            <div>• Hide labels for better performance</div>
          </div>
        </>
      )}
    </div>
  )
}
