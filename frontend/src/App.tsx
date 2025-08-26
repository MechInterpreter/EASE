import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { defaultParams, type GraphInfo, type RunRequest, type RunSummary, type Snapshot, type LayoutType } from './types'
import { getGraphInfo, postRun, getReplay } from './api'
import Controls from './components/Controls'
import MetricsBar from './components/MetricsBar'
import GraphView from './components/GraphView'

export default function App() {
  const [graph, setGraph] = useState<GraphInfo | null>(null)
  const [params, setParams] = useState<RunRequest>({ ...defaultParams })
  const [summary, setSummary] = useState<RunSummary | null>(null)
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [k, setK] = useState(0)
  const [timeline, setTimeline] = useState(0)
  const [running, setRunning] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [edgeOpacityThreshold, setEdgeOpacityThreshold] = useState(0.1)
  const [layout, setLayout] = useState<LayoutType>('force')

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const graphUrl = q.get('graph') ?? undefined
    getGraphInfo(graphUrl).then(setGraph).catch(err => console.error('graph/info error', err))
  }, [])

  useEffect(() => {
    let t: any
    if (playing && timeline > 0) {
      t = setInterval(() => {
        setK(prev => {
          const next = prev + 1
          if (next > timeline) return 0
          return next
        })
      }, 700)
    }
    return () => t && clearInterval(t)
  }, [playing, timeline])

  useEffect(() => {
    if (summary) {
      getReplay(k, edgeOpacityThreshold, layout).then(setSnap).catch(console.error)
    }
  }, [k, summary, edgeOpacityThreshold, layout])

  const onRun = async () => {
    try {
      setRunning(true)
      const s = await postRun(params)
      setSummary(s)
      setTimeline(s.stats.timeline_len)
      setK(0)
      const sn = await getReplay(0, edgeOpacityThreshold, layout)
      setSnap(sn)
    } catch (e) {
      console.error(e)
    } finally {
      setRunning(false)
    }
  }

  const onReset = () => {
    setParams({ ...defaultParams })
    setSummary(null)
    setSnap(null)
    setK(0)
    setTimeline(0)
    setPlaying(false)
  }

  const applyGraph = (gi: GraphInfo) => {
    setGraph(gi)
    // Reset run artifacts on graph change
    setSummary(null)
    setSnap(null)
    setK(0)
    setTimeline(0)
    setPlaying(false)
  }

  return (
    <div className="h-screen w-screen grid grid-cols-12">
      <div className="col-span-4 border-r overflow-auto">
        <div className="p-3 border-b text-sm">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold">EASE Controls</div>
              <div className="text-neutral-500">Nodes: {graph?.num_nodes ?? '…'} • Edges: {graph?.num_edges ?? '…'}</div>
            </div>
            <Link 
              to="/graph" 
              className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            >
              D3 Graphs
            </Link>
          </div>
        </div>
        <Controls graph={graph} setGraph={applyGraph} params={params} setParams={setParams} onRun={onRun} running={running} onReset={onReset} k={k} setK={setK} timelineLen={timeline} playing={playing} setPlaying={setPlaying} edgeOpacityThreshold={edgeOpacityThreshold} setEdgeOpacityThreshold={setEdgeOpacityThreshold} layout={layout} setLayout={setLayout} />
      </div>
      <div className="col-span-8 flex flex-col">
        <MetricsBar summary={summary} snap={snap} />
        <div className="flex-1 overflow-hidden">
          <GraphView snap={snap} />
        </div>
      </div>
    </div>
  )
}
