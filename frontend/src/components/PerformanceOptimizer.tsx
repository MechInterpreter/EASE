// Performance Optimizer - Canvas/WebGL rendering, top-k edges, debounced updates, Web Workers
import React, { useRef, useEffect, useCallback } from 'react'
import type { GraphNode, GraphLink } from '../lib/graph-types'

interface PerformanceOptimizerProps {
  nodes: GraphNode[]
  links: GraphLink[]
  topK?: number
  enableWebGL?: boolean
  debounceMs?: number
  onRenderComplete?: (stats: RenderStats) => void
}

interface RenderStats {
  nodesRendered: number
  edgesRendered: number
  renderTime: number
  frameRate: number
}

// Web Worker for heavy computations
const createLayoutWorker = () => {
  const workerCode = `
    self.onmessage = function(e) {
      const { nodes, links, iterations } = e.data;
      
      // Simple force-directed layout computation
      for (let i = 0; i < iterations; i++) {
        // Repulsion between nodes
        for (let j = 0; j < nodes.length; j++) {
          const node = nodes[j];
          let fx = 0, fy = 0;
          
          for (let k = 0; k < nodes.length; k++) {
            if (j === k) continue;
            const other = nodes[k];
            const dx = node.x - other.x;
            const dy = node.y - other.y;
            const distance = Math.sqrt(dx * dx + dy * dy) || 1;
            const force = 100 / (distance * distance);
            fx += (dx / distance) * force;
            fy += (dy / distance) * force;
          }
          
          node.vx = (node.vx || 0) * 0.9 + fx * 0.01;
          node.vy = (node.vy || 0) * 0.9 + fy * 0.01;
        }
        
        // Attraction along edges
        for (const link of links) {
          const source = nodes.find(n => n.id === link.source);
          const target = nodes.find(n => n.id === link.target);
          if (!source || !target) continue;
          
          const dx = target.x - source.x;
          const dy = target.y - source.y;
          const distance = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = distance * 0.01;
          
          source.vx += (dx / distance) * force;
          source.vy += (dy / distance) * force;
          target.vx -= (dx / distance) * force;
          target.vy -= (dy / distance) * force;
        }
        
        // Update positions
        for (const node of nodes) {
          node.x += node.vx || 0;
          node.y += node.vy || 0;
          node.pos = [node.x, node.y];
        }
      }
      
      self.postMessage({ nodes });
    };
  `
  
  const blob = new Blob([workerCode], { type: 'application/javascript' })
  return new Worker(URL.createObjectURL(blob))
}

export default function PerformanceOptimizer({
  nodes,
  links,
  topK = 1000,
  enableWebGL = false,
  debounceMs = 16,
  onRenderComplete
}: PerformanceOptimizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const glRef = useRef<WebGLRenderingContext | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const animationRef = useRef<number | null>(null)
  const lastRenderTime = useRef<number>(0)
  const frameCount = useRef<number>(0)

  // Initialize WebGL if enabled
  const initWebGL = useCallback(() => {
    if (!enableWebGL || !canvasRef.current) return false

    const gl = canvasRef.current.getContext('webgl')
    if (!gl) {
      console.warn('WebGL not supported, falling back to Canvas 2D')
      return false
    }

    glRef.current = gl

    // Vertex shader for nodes
    const vertexShaderSource = `
      attribute vec2 a_position;
      attribute float a_size;
      attribute vec3 a_color;
      
      uniform vec2 u_resolution;
      uniform mat3 u_transform;
      
      varying vec3 v_color;
      varying float v_size;
      
      void main() {
        vec3 position = u_transform * vec3(a_position, 1.0);
        vec2 clipSpace = ((position.xy / u_resolution) * 2.0) - 1.0;
        gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
        gl_PointSize = a_size;
        v_color = a_color;
        v_size = a_size;
      }
    `

    // Fragment shader for nodes
    const fragmentShaderSource = `
      precision mediump float;
      
      varying vec3 v_color;
      varying float v_size;
      
      void main() {
        vec2 center = gl_PointCoord - vec2(0.5);
        float distance = length(center);
        if (distance > 0.5) discard;
        
        float alpha = 1.0 - smoothstep(0.3, 0.5, distance);
        gl_FragColor = vec4(v_color, alpha);
      }
    `

    // Compile shaders and create program
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource)
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource)
    
    if (!vertexShader || !fragmentShader) return false

    const program = createProgram(gl, vertexShader, fragmentShader)
    if (!program) return false

    // Store program for later use
    ;(gl as any).program = program

    return true
  }, [enableWebGL])

  // Create shader helper
  const createShader = (gl: WebGLRenderingContext, type: number, source: string) => {
    const shader = gl.createShader(type)
    if (!shader) return null

    gl.shaderSource(shader, source)
    gl.compileShader(shader)

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader))
      gl.deleteShader(shader)
      return null
    }

    return shader
  }

  // Create program helper
  const createProgram = (gl: WebGLRenderingContext, vertexShader: WebGLShader, fragmentShader: WebGLShader) => {
    const program = gl.createProgram()
    if (!program) return null

    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.linkProgram(program)

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program))
      gl.deleteProgram(program)
      return null
    }

    return program
  }

  // Filter top-k edges by weight
  const getTopKEdges = useCallback((allLinks: GraphLink[], k: number): GraphLink[] => {
    return allLinks
      .slice()
      .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
      .slice(0, k)
  }, [])

  // Debounced render function
  const debouncedRender = useCallback(
    debounce((nodes: GraphNode[], links: GraphLink[]) => {
      const startTime = performance.now()
      
      if (enableWebGL && glRef.current) {
        renderWebGL(nodes, links)
      } else {
        renderCanvas2D(nodes, links)
      }
      
      const endTime = performance.now()
      const renderTime = endTime - startTime
      
      frameCount.current++
      const now = performance.now()
      const frameRate = frameCount.current / ((now - lastRenderTime.current) / 1000)
      
      if (now - lastRenderTime.current > 1000) {
        frameCount.current = 0
        lastRenderTime.current = now
      }

      onRenderComplete?.({
        nodesRendered: nodes.length,
        edgesRendered: links.length,
        renderTime,
        frameRate
      })
    }, debounceMs),
    [enableWebGL, debounceMs, onRenderComplete]
  )

  // WebGL rendering
  const renderWebGL = (nodes: GraphNode[], links: GraphLink[]) => {
    const gl = glRef.current
    if (!gl || !(gl as any).program) return

    const program = (gl as any).program
    gl.useProgram(program)

    // Clear canvas
    gl.clearColor(0.0, 0.0, 0.0, 0.0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    // Prepare node data
    const positions: number[] = []
    const sizes: number[] = []
    const colors: number[] = []

    nodes.forEach(node => {
      positions.push(node.x || 0, node.y || 0)
      sizes.push(Math.max(2, Math.sqrt(node.size || 1) * 3))
      
      // Parse color or use default
      const color = node.nodeColor || '#6b7280'
      const rgb = hexToRgb(color)
      colors.push(rgb.r / 255, rgb.g / 255, rgb.b / 255)
    })

    // Create and bind buffers
    const positionBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW)

    const positionLocation = gl.getAttribLocation(program, 'a_position')
    gl.enableVertexAttribArray(positionLocation)
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)

    // Render nodes
    gl.drawArrays(gl.POINTS, 0, nodes.length)
  }

  // Canvas 2D rendering (fallback)
  const renderCanvas2D = (nodes: GraphNode[], links: GraphLink[]) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1

    // Set canvas size
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`
    ctx.scale(dpr, dpr)

    // Clear canvas
    ctx.clearRect(0, 0, rect.width, rect.height)

    // Render edges (top-k only)
    const topKLinks = getTopKEdges(links, topK)
    ctx.globalAlpha = 0.3
    ctx.lineCap = 'round'

    topKLinks.forEach(link => {
      if (!link.sourceNode?.pos || !link.targetNode?.pos) return

      ctx.beginPath()
      ctx.moveTo(link.sourceNode.pos[0], link.sourceNode.pos[1])
      ctx.lineTo(link.targetNode.pos[0], link.targetNode.pos[1])
      ctx.strokeStyle = link.color || '#666'
      ctx.lineWidth = Math.max(0.5, link.strokeWidth || 1)
      ctx.stroke()
    })

    // Render nodes
    ctx.globalAlpha = 0.8
    nodes.forEach(node => {
      if (!node.pos) return

      const radius = Math.max(2, Math.sqrt(node.size || 1) * 3)
      
      ctx.beginPath()
      ctx.arc(node.pos[0], node.pos[1], radius, 0, 2 * Math.PI)
      ctx.fillStyle = node.nodeColor || '#6b7280'
      ctx.fill()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 1
      ctx.stroke()
    })

    ctx.globalAlpha = 1
  }

  // Helper function to convert hex to RGB
  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 107, g: 114, b: 128 }
  }

  // Initialize Web Worker
  useEffect(() => {
    workerRef.current = createLayoutWorker()
    
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate()
      }
    }
  }, [])

  // Initialize WebGL
  useEffect(() => {
    if (enableWebGL) {
      initWebGL()
    }
  }, [enableWebGL, initWebGL])

  // Render when data changes
  useEffect(() => {
    if (nodes.length > 0) {
      const topKLinks = getTopKEdges(links, topK)
      debouncedRender(nodes, topKLinks)
    }
  }, [nodes, links, topK, debouncedRender, getTopKEdges])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
      style={{ zIndex: 1 }}
    />
  )
}

// Debounce utility
function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: number | null = null
  
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout)
    timeout = window.setTimeout(() => func(...args), wait)
  }
}
