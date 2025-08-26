// Timeline Controls - Animation of merge steps with speed controls
import React, { useState, useCallback, useEffect } from 'react'
import { Play, Pause, SkipBack, SkipForward, FastForward, Rewind } from 'lucide-react'

interface TimelineControlsProps {
  totalSteps: number
  currentStep: number
  isPlaying: boolean
  speed: number
  onStepChange?: (step: number) => void
  onPlayPause?: () => void
  onSpeedChange?: (speed: number) => void
  onStepForward?: () => void
  onStepBackward?: () => void
  onJumpSteps?: (delta: number) => void
  darkMode?: boolean
}

interface MergeStep {
  step: number
  mergedNodes: string[]
  newSupernodeId: string
  timestamp: number
  metrics: {
    similarity: number
    size: number
    influence: number
  }
}

export default function TimelineControls({
  totalSteps,
  currentStep,
  isPlaying,
  speed,
  onStepChange,
  onPlayPause,
  onSpeedChange,
  onStepForward,
  onStepBackward,
  onJumpSteps,
  darkMode = false
}: TimelineControlsProps) {
  const [hoveredStep, setHoveredStep] = useState<number | null>(null)

  // Speed presets
  const speedOptions = [0.25, 0.5, 1, 2, 4, 8]

  const handleSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const step = parseInt(e.target.value)
    onStepChange?.(step)
  }, [onStepChange])

  const handleSpeedSelect = useCallback((newSpeed: number) => {
    onSpeedChange?.(newSpeed)
  }, [onSpeedChange])

  const formatTime = useCallback((step: number) => {
    const seconds = Math.floor(step / 10) // Assuming 10 steps per second
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
  }, [])

  return (
    <div className={`space-y-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Timeline Animation</h3>
        <div className="text-xs text-gray-500">
          Step {currentStep} / {totalSteps}
        </div>
      </div>

      {/* Timeline Slider */}
      <div className="space-y-2">
        <div className="relative">
          <input
            type="range"
            min="0"
            max={totalSteps}
            value={currentStep}
            onChange={handleSliderChange}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
            style={{
              background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${(currentStep / totalSteps) * 100}%, ${darkMode ? '#374151' : '#e5e7eb'} ${(currentStep / totalSteps) * 100}%, ${darkMode ? '#374151' : '#e5e7eb'} 100%)`
            }}
          />
          
          {/* Step markers */}
          <div className="absolute top-0 left-0 w-full h-2 pointer-events-none">
            {Array.from({ length: Math.min(totalSteps, 20) }, (_, i) => {
              const step = Math.floor((i / 19) * totalSteps)
              const position = (step / totalSteps) * 100
              return (
                <div
                  key={step}
                  className="absolute w-1 h-2 bg-gray-400 rounded-full"
                  style={{ left: `${position}%`, transform: 'translateX(-50%)' }}
                />
              )
            })}
          </div>
        </div>

        <div className="flex justify-between text-xs text-gray-500">
          <span>{formatTime(0)}</span>
          <span>{formatTime(totalSteps)}</span>
        </div>
      </div>

      {/* Playback Controls */}
      <div className="flex items-center justify-center space-x-2">
        <button
          onClick={() => onJumpSteps?.(-10)}
          className={`p-2 rounded-lg transition-colors ${
            darkMode
              ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
          title="Jump back 10 steps"
        >
          <Rewind className="w-4 h-4" />
        </button>

        <button
          onClick={onStepBackward}
          className={`p-2 rounded-lg transition-colors ${
            darkMode
              ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
          title="Previous step"
        >
          <SkipBack className="w-4 h-4" />
        </button>

        <button
          onClick={onPlayPause}
          className={`p-3 rounded-lg transition-colors ${
            isPlaying
              ? 'bg-red-500 text-white hover:bg-red-600'
              : 'bg-green-500 text-white hover:bg-green-600'
          }`}
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
        </button>

        <button
          onClick={onStepForward}
          className={`p-2 rounded-lg transition-colors ${
            darkMode
              ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
          title="Next step"
        >
          <SkipForward className="w-4 h-4" />
        </button>

        <button
          onClick={() => onJumpSteps?.(10)}
          className={`p-2 rounded-lg transition-colors ${
            darkMode
              ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
          title="Jump forward 10 steps"
        >
          <FastForward className="w-4 h-4" />
        </button>
      </div>

      {/* Speed Control */}
      <div className="space-y-2">
        <label className="block text-xs font-medium">Playback Speed</label>
        <div className="grid grid-cols-6 gap-1">
          {speedOptions.map(speedOption => (
            <button
              key={speedOption}
              onClick={() => handleSpeedSelect(speedOption)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                speed === speedOption
                  ? 'bg-blue-500 text-white'
                  : darkMode
                    ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              {speedOption}x
            </button>
          ))}
        </div>
      </div>

      {/* Current Step Info */}
      <div className={`p-3 rounded-lg border ${
        darkMode ? 'bg-gray-800 border-gray-600' : 'bg-gray-50 border-gray-200'
      }`}>
        <div className="text-xs font-medium mb-1">Current Step</div>
        <div className="text-xs space-y-1">
          <div>Step: {currentStep}</div>
          <div>Progress: {((currentStep / totalSteps) * 100).toFixed(1)}%</div>
          <div>Time: {formatTime(currentStep)}</div>
        </div>
      </div>

      {/* Animation Settings */}
      <div className="space-y-3 pt-3 border-t border-gray-200 dark:border-gray-600">
        <label className="block text-xs font-medium">Animation Settings</label>
        
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs">Highlight Duration</span>
            <span className="text-xs text-gray-500">2s</span>
          </div>
          
          <div className="flex items-center justify-between">
            <span className="text-xs">Fade Transition</span>
            <span className="text-xs text-gray-500">0.5s</span>
          </div>
          
          <div className="flex items-center justify-between">
            <span className="text-xs">Node Pulse</span>
            <button className="text-xs text-blue-500 hover:text-blue-600">
              Enabled
            </button>
          </div>
        </div>
      </div>

      {/* Keyboard Shortcuts */}
      <div className={`text-xs pt-3 border-t border-gray-200 dark:border-gray-600 ${
        darkMode ? 'text-gray-400' : 'text-gray-600'
      }`}>
        <div className="font-medium mb-1">Keyboard Shortcuts:</div>
        <div className="space-y-1">
          <div>• Space: Play/Pause</div>
          <div>• ←/→: Step backward/forward</div>
          <div>• Shift+←/→: Jump 10 steps</div>
          <div>• 1-6: Set speed (0.25x-8x)</div>
        </div>
      </div>
    </div>
  )
}
