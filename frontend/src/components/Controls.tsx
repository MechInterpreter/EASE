import React, { useEffect, useMemo, useState } from 'react'
import type { GraphInfo, RunRequest, LayoutType } from '../types'
import { loadGraphFromUrl, uploadGraph, validateGraph } from '../api'

function Slider({ label, min, max, step, value, onChange, disabled }: { label: string; min: number; max: number; step: number; value: number; onChange: (v:number)=>void; disabled?: boolean }) {
  return (
    <label className="block text-sm mb-3">
      <div className="flex justify-between"><span className="font-semibold">{label}</span><span>{value}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(parseFloat(e.target.value))} className="w-full" disabled={disabled} />
    </label>
  )
}

export default function Controls({ graph, setGraph, params, setParams, onRun, running, onReset, k, setK, timelineLen, playing, setPlaying, edgeOpacityThreshold, setEdgeOpacityThreshold, layout, setLayout }: {
  graph: GraphInfo | null
  setGraph: (g: GraphInfo) => void
  params: RunRequest
  setParams: (p: RunRequest) => void
  onRun: ()=>void
  running: boolean
  onReset: ()=>void
  k: number
  setK: (n:number)=>void
  timelineLen: number
  playing: boolean
  setPlaying: (b:boolean)=>void
  edgeOpacityThreshold: number
  setEdgeOpacityThreshold: (n:number)=>void
  layout: LayoutType
  setLayout: (l: LayoutType)=>void
}) {
  const layers = graph?.layers ?? []
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [notes, setNotes] = useState<string[]>([])

  const toggleLayer = (L: number) => {
    const cur = new Set(params.layer_whitelist ?? [])
    if (cur.has(L)) cur.delete(L); else cur.add(L)
    const wl = Array.from(cur).sort((a,b)=>a-b)
    setParams({ ...params, layer_whitelist: wl.length ? wl : null })
  }

  return (
    <div className="p-4 space-y-4 text-sm w-full">
      <div className="space-y-2">
        <div className="font-semibold">Load Graph</div>
        <div className="flex gap-2">
          <input className="flex-1 border rounded px-2 py-1" placeholder="https://.../graph.json" value={url} onChange={e=>setUrl(e.target.value)} />
          <button className="px-3 py-1 rounded border" disabled={!url || busy} onClick={async()=>{
            try {
              setBusy(true)
              const res = await loadGraphFromUrl(url)
              setGraph(res.info)
              setNotes(res.notes)
            } catch (e) {
              setNotes([String(e)])
            } finally {
              setBusy(false)
            }
          }}>Load</button>
        </div>
        <div className="flex items-center gap-2">
          <label className="px-2 py-1 border rounded cursor-pointer">
            <input type="file" accept="application/json" className="hidden" onChange={async e=>{
              const f = e.target.files?.[0]
              if (!f) return
              try {
                setBusy(true)
                const res = await uploadGraph(f)
                setGraph(res.info)
                setNotes(res.notes)
              } catch (err) {
                setNotes([String(err)])
              } finally {
                setBusy(false)
                e.currentTarget.value = ''
              }
            }} />
            Upload JSON
          </label>
          <label className="px-2 py-1 border rounded cursor-pointer">
            <input type="file" accept="application/json" className="hidden" onChange={async e=>{
              const f = e.target.files?.[0]
              if (!f) return
              try {
                setBusy(true)
                const res = await validateGraph(f)
                setNotes([`Validated: ${res.info.num_nodes} nodes, ${res.info.num_edges} edges`, ...res.notes])
              } catch (err) {
                setNotes([String(err)])
              } finally {
                setBusy(false)
                e.currentTarget.value = ''
              }
            }} />
            Validate JSON
          </label>
          {busy && <span className="text-xs text-neutral-500">loading…</span>}
        </div>
        {!!notes.length && (
          <div className="text-xs text-neutral-600 bg-neutral-50 border rounded p-2 whitespace-pre-wrap">{notes.join('\n')}</div>
        )}
      </div>
      <div className="flex gap-2">
        <button className="px-3 py-1 rounded bg-blue-600 text-white disabled:opacity-50" onClick={onRun} disabled={running}>Run</button>
        <button className="px-3 py-1 rounded border" onClick={onReset} disabled={running}>Reset</button>
        <button className="px-3 py-1 rounded border" onClick={()=>setPlaying(!playing)} disabled={!timelineLen}>{playing ? 'Pause' : 'Play'}</button>
      </div>
      <div>
        <div className="font-semibold mb-1">Timeline</div>
        <input type="range" min={0} max={timelineLen} step={1} value={k} onChange={e=>setK(parseInt(e.target.value))} className="w-full" disabled={!timelineLen} />
        <div className="text-xs text-neutral-500">k = {k} / {timelineLen}</div>
      </div>

      <div className="border-t pt-3">
        <Slider label="tau_sim" min={0.90} max={0.995} step={0.001} value={params.tau_sim} onChange={v=>setParams({ ...params, tau_sim: v })} disabled={running} />
        <Slider label="alpha" min={0.80} max={0.99} step={0.005} value={params.alpha} onChange={v=>setParams({ ...params, alpha: v })} disabled={running} />
        <Slider label="beta" min={0.00} max={0.20} step={0.005} value={params.beta} onChange={v=>setParams({ ...params, beta: v })} disabled={running} />
      </div>

      <details className="border rounded p-3">
        <summary className="cursor-pointer font-semibold">Advanced</summary>
        <div className="mt-3 space-y-3">
          <div>
            <label className="mr-2"><input type="checkbox" checked={params.gate_enabled} onChange={e=>setParams({ ...params, gate_enabled: e.target.checked })} /> Gate enabled</label>
            <label className="ml-4"><input type="checkbox" checked={params.normalize_fingerprints} onChange={e=>setParams({ ...params, normalize_fingerprints: e.target.checked })} /> Normalize fingerprints</label>
          </div>
          <div className="flex gap-2 items-center">
            <label className="font-semibold">similarity</label>
            <select value={params.similarity_metric} onChange={e=>setParams({ ...params, similarity_metric: e.target.value as any })} className="border rounded px-2 py-1">
              <option value="cosine">cosine</option>
              <option value="dot">dot</option>
            </select>
            <label className="font-semibold ml-3">fingerprints</label>
            <select value={params.fingerprint_source} onChange={e=>setParams({ ...params, fingerprint_source: e.target.value as any })} className="border rounded px-2 py-1">
              <option value="delta_logit">delta_logit</option>
              <option value="adjacency">adjacency</option>
            </select>
          </div>
          <div className="flex gap-2 items-center">
            <label className="font-semibold">layout</label>
            <select value={layout} onChange={e=>setLayout(e.target.value as LayoutType)} className="border rounded px-2 py-1">
              <option value="force">force</option>
              <option value="layered">layered</option>
            </select>
          </div>
          <Slider label="edge_opacity_threshold" min={0} max={1} step={0.01} value={edgeOpacityThreshold} onChange={v=>setEdgeOpacityThreshold(v)} disabled={running} />
          <Slider label="topk_candidates_per_node" min={0} max={200} step={1} value={params.topk_candidates_per_node} onChange={v=>setParams({ ...params, topk_candidates_per_node: Math.round(v) })} disabled={running} />
          <label className="block">max_pairs_per_layer <input className="ml-2 border rounded px-2 py-1 w-32" type="number" value={params.max_pairs_per_layer} onChange={e=>setParams({ ...params, max_pairs_per_layer: parseInt(e.target.value) })} /></label>
          <label className="block">max_merges <input className="ml-2 border rounded px-2 py-1 w-32" type="number" value={params.max_merges} onChange={e=>setParams({ ...params, max_merges: parseInt(e.target.value) })} /></label>
          <label className="block">min_group_size_postfilter <input className="ml-2 border rounded px-2 py-1 w-32" type="number" value={params.min_group_size_postfilter} onChange={e=>setParams({ ...params, min_group_size_postfilter: parseInt(e.target.value) })} /></label>
          <label className="block">seed <input className="ml-2 border rounded px-2 py-1 w-32" type="number" value={params.seed} onChange={e=>setParams({ ...params, seed: parseInt(e.target.value) })} /></label>
          <div>
            <div className="font-semibold mb-1">Layer whitelist</div>
            <div className="flex flex-wrap gap-2">
              {layers.map(L => (
                <label key={L} className="text-xs border rounded px-2 py-1">
                  <input type="checkbox" className="mr-1" checked={(params.layer_whitelist ?? []).includes(L)} onChange={()=>toggleLayer(L)} /> L{L}
                </label>
              ))}
            </div>
          </div>
        </div>
      </details>
    </div>
  )
}
