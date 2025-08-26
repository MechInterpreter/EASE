import React from 'react'
import type { RunSummary, Snapshot } from '../types'

export default function MetricsBar({ summary, snap }: { summary: RunSummary | null; snap: Snapshot | null }) {
  const cr = snap?.cr ?? summary?.stats.cr ?? 1
  const accepted = summary?.stats.num_accepted ?? 0
  const proposed = summary?.stats.num_candidates ?? 0
  const meanGroup = snap?.metrics.mean_group_size ?? 0
  const numGroups = snap?.metrics.num_groups ?? 0
  return (
    <div className="w-full flex gap-6 text-sm py-2 px-3 border-b bg-white dark:bg-neutral-900 dark:text-neutral-200">
      <div><span className="font-semibold">CR:</span> {cr.toFixed(3)}</div>
      <div><span className="font-semibold">Accepted:</span> {accepted} / {proposed}</div>
      <div><span className="font-semibold">Mean group size:</span> {meanGroup.toFixed(2)}</div>
      <div><span className="font-semibold">Groups:</span> {numGroups}</div>
    </div>
  )
}
