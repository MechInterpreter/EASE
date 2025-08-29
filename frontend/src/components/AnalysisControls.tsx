// Analysis Controls - τ_sim, α, β, gating, seed, layer whitelist, Run button
import React, { useState, useCallback } from 'react'
import { Play, RotateCcw, Settings } from 'lucide-react'

interface AnalysisControlsProps {
  onRun?: (params: AnalysisParams) => void
  onReset?: () => void
  isRunning?: boolean
  darkMode?: boolean
}

export interface AnalysisParams {
  tau_sim: number
  alpha: number
  beta: number
  gating: number
  seed: number
  layerWhitelist: number[]
  batchSize: number
  maxIterations: number
}

const DEFAULT_PARAMS: AnalysisParams = {
  tau_sim: 0.98,  // Minimum cosine similarity for candidate merge
  alpha: 0.9,     // Minimum mean correlation
  beta: 0.05,     // Maximum cross-entropy gap
  gating: 0.5,
  seed: 42,
  layerWhitelist: [],
  batchSize: 32,
  maxIterations: 1000
}

export default function AnalysisControls({
  onRun,
  onReset,
  isRunning = false,
  darkMode = false
}: AnalysisControlsProps) {
  const [params, setParams] = useState<AnalysisParams>(DEFAULT_PARAMS)
  const [layerInput, setLayerInput] = useState('')

  const updateParam = useCallback(<K extends keyof AnalysisParams>(
    key: K,
    value: AnalysisParams[K]
  ) => {
    setParams(prev => ({ ...prev, [key]: value }))
  }, [])

  const handleLayerWhitelistChange = useCallback((value: string) => {
    setLayerInput(value)
    const layers = value
      .split(',')
      .map(s => parseInt(s.trim()))
      .filter(n => !isNaN(n))
    updateParam('layerWhitelist', layers)
  }, [updateParam])

  const handleRun = useCallback(() => {
    onRun?.(params)
  }, [params, onRun])

  const handleReset = useCallback(() => {
    setParams(DEFAULT_PARAMS)
    setLayerInput('')
    onReset?.()
  }, [onReset])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Analysis Parameters</h3>
        <Settings className="w-4 h-4 text-gray-500" />
      </div>

      {/* Core Parameters */}
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium mb-1">
            α (Min Mean Correlation)
            <span className="ml-1 text-gray-500 font-normal" title="Minimum mean correlation required for merging">?</span>
          </label>
          <div className="flex items-center space-x-2">
            <input
              type="range"
              min="0.5"
              max="1.0"
              step="0.01"
              value={params.alpha}
              onChange={(e) => updateParam('alpha', parseFloat(e.target.value))}
              className="flex-1"
            />
            <span className="text-xs w-12 text-right">{params.alpha.toFixed(2)}</span>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1">
            β (Max Cross-Entropy Gap)
            <span className="ml-1 text-gray-500 font-normal" title="Maximum cross-entropy gap admitted by the fidelity gate">?</span>
          </label>
          <div className="flex items-center space-x-2">
            <input
              type="range"
              min="0"
              max="0.2"
              step="0.005"
              value={params.beta}
              onChange={(e) => updateParam('beta', parseFloat(e.target.value))}
              className="flex-1"
            />
            <span className="text-xs w-12 text-right">{params.beta.toFixed(2)}</span>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1">
            Gating Threshold
          </label>
          <div className="flex items-center space-x-2">
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={params.gating}
              onChange={(e) => updateParam('gating', parseFloat(e.target.value))}
              className="flex-1"
            />
            <span className="text-xs w-12 text-right">{params.gating.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Advanced Parameters */}
      <div className="space-y-3 pt-3 border-t border-gray-200 dark:border-gray-600">
        <div>
          <label className="block text-xs font-medium mb-1">
            Random Seed
          </label>
          <input
            type="number"
            value={params.seed}
            onChange={(e) => updateParam('seed', parseInt(e.target.value) || 0)}
            className={`w-full px-2 py-1 text-xs border rounded ${
              darkMode
                ? 'bg-gray-700 border-gray-600 text-white'
                : 'bg-white border-gray-300 text-gray-900'
            }`}
          />
        </div>

        <div>
          <label className="block text-xs font-medium mb-1">
            Layer Whitelist (comma-separated)
          </label>
          <input
            type="text"
            value={layerInput}
            onChange={(e) => handleLayerWhitelistChange(e.target.value)}
            placeholder="e.g., 0,1,2,5"
            className={`w-full px-2 py-1 text-xs border rounded ${
              darkMode
                ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400'
                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'
            }`}
          />
          {params.layerWhitelist.length > 0 && (
            <div className="mt-1 text-xs text-gray-500">
              Active layers: {params.layerWhitelist.join(', ')}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium mb-1">
              Batch Size
            </label>
            <input
              type="number"
              value={params.batchSize}
              onChange={(e) => updateParam('batchSize', parseInt(e.target.value) || 1)}
              min="1"
              max="256"
              className={`w-full px-2 py-1 text-xs border rounded ${
                darkMode
                  ? 'bg-gray-700 border-gray-600 text-white'
                  : 'bg-white border-gray-300 text-gray-900'
              }`}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">
              Max Iterations
            </label>
            <input
              type="number"
              value={params.maxIterations}
              onChange={(e) => updateParam('maxIterations', parseInt(e.target.value) || 1)}
              min="1"
              max="10000"
              className={`w-full px-2 py-1 text-xs border rounded ${
                darkMode
                  ? 'bg-gray-700 border-gray-600 text-white'
                  : 'bg-white border-gray-300 text-gray-900'
              }`}
            />
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2 pt-3 border-t border-gray-200 dark:border-gray-600">
        <button
          onClick={handleRun}
          disabled={isRunning}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
            isRunning
              ? 'bg-gray-400 text-white cursor-not-allowed'
              : 'bg-blue-500 text-white hover:bg-blue-600'
          }`}
        >
          <Play className="w-4 h-4" />
          {isRunning ? 'Running...' : 'Run Analysis'}
        </button>

        <button
          onClick={handleReset}
          disabled={isRunning}
          className={`px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
            isRunning
              ? 'opacity-50 cursor-not-allowed'
              : ''
          } ${
            darkMode
              ? 'bg-gray-700 text-gray-300 border-gray-600 hover:bg-gray-600'
              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
          }`}
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>

      {/* Parameter Descriptions */}
      <div className={`text-xs space-y-1 pt-3 border-t border-gray-200 dark:border-gray-600 ${
        darkMode ? 'text-gray-400' : 'text-gray-600'
      }`}>
        <div className="font-medium">Parameter Guide:</div>
        <div>• τ_sim: Minimum cosine similarity for candidate merge</div>
        <div>• α: Minimum mean correlation between nodes</div>
        <div>• β: Maximum cross-entropy gap for fidelity gate</div>
        <div>• Gating: Threshold for edge pruning</div>
        <div>• Seed: Reproducible random initialization</div>
        <div>• Whitelist: Only analyze specified layers</div>
      </div>
    </div>
  )
}
