import type { GraphInfo, RunRequest, RunSummary, Snapshot, LayoutType, GraphValidation } from './types'

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`${res.status} ${res.statusText}: ${txt}`)
  }
  return res.json()
}

export async function getGraphInfo(graphUrl?: string): Promise<GraphInfo> {
  let url = '/api/graph/info'
  if (graphUrl) {
    const q = new URLSearchParams({ graph: graphUrl })
    url += `?${q.toString()}`
  }
  return fetchJSON<GraphInfo>(url)
}

export async function postRun(params: RunRequest): Promise<RunSummary> {
  return fetchJSON<RunSummary>('/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
}

export async function getReplay(step: number, edgeOpacityThreshold = 0.1, layout: LayoutType = 'force') {
  const q = new URLSearchParams({ step: String(step), edge_opacity_threshold: String(edgeOpacityThreshold), layout })
  return fetchJSON<Snapshot>(`/api/replay?${q.toString()}`)
}

export async function loadGraphFromUrl(url: string): Promise<GraphValidation> {
  return fetchJSON<GraphValidation>('/api/graph/load/url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
}

export async function uploadGraph(file: File): Promise<GraphValidation> {
  const fd = new FormData()
  fd.append('file', file)
  return fetchJSON<GraphValidation>('/api/graph/upload', {
    method: 'POST',
    body: fd,
  })
}

export async function validateGraph(file: File): Promise<GraphValidation> {
  const fd = new FormData()
  fd.append('file', file)
  return fetchJSON<GraphValidation>('/api/graph/validate', {
    method: 'POST',
    body: fd,
  })
}
