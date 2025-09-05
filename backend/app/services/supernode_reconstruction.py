"""
Automated Supernode Reconstruction Service

Implements the fidelity-gated automated supernode discovery pipeline
based on similarity proposals, fidelity gates, and DSU merging.
"""

import numpy as np
from typing import Dict, List, Tuple, Set, Optional, Any
from dataclasses import dataclass
from collections import defaultdict
import json
import logging
import time
from scipy.spatial.distance import cosine
from sklearn.metrics.pairwise import cosine_similarity

logger = logging.getLogger(__name__)

def _safe_float(val: Any, default: float = 0.0) -> float:
    """Convert values that may be None/str/num to a finite float, else default."""
    try:
        if val is None:
            return default
        f = float(val)
        # Guard against NaN/inf
        if np.isnan(f) or np.isinf(f):
            return default
        return f
    except Exception:
        return default

@dataclass
class ReconstructionConfig:
    """Configuration for supernode reconstruction"""
    tau_sim: float = 0.85  # Minimum cosine similarity for candidate merges (tuned for Charlotte)
    alpha: float = 0.80    # Minimum mean correlation for fidelity gate (tuned for Charlotte)
    beta: float = 0.50     # Maximum cross-entropy gap for fidelity gate (tuned for Charlotte)
    intra_layer_only: bool = False  # Allow cross-layer merges by default; set True to restrict within layers
    max_supernode_size: int = 10  # Maximum nodes that can be merged into one supernode
    max_duplicate_group_size: int = 5  # Skip duplicate groups larger than this
    
@dataclass
class NodeFingerprint:
    """Fingerprint for a node based on logit influence patterns"""
    node_id: str
    layer: str
    feature_type: str
    fingerprint: np.ndarray  # L2-normalized logit influence vector
    original_influence: float
    
@dataclass
class MergeCandidate:
    """Candidate merge between two nodes"""
    node1_id: str
    node2_id: str
    similarity: float
    layer: str
    
@dataclass
class SupernodeGroup:
    """A merged supernode group"""
    id: str
    members: List[str]
    layer: str
    size: int
    mean_influence: float
    fingerprint: np.ndarray
    
class DisjointSetUnion:
    """Disjoint Set Union data structure for efficient merging"""
    
    def __init__(self, nodes: List[str]):
        self.parent = {node: node for node in nodes}
        self.rank = {node: 0 for node in nodes}
        self.groups = {node: {node} for node in nodes}
    
    def find(self, node: str) -> str:
        """Find root of the set containing node"""
        if self.parent[node] != node:
            self.parent[node] = self.find(self.parent[node])
        return self.parent[node]
    
    def union(self, node1: str, node2: str) -> bool:
        """Union two sets, return True if merge happened"""
        root1, root2 = self.find(node1), self.find(node2)
        if root1 == root2:
            return False
            
        # Union by rank
        if self.rank[root1] < self.rank[root2]:
            root1, root2 = root2, root1
        
        self.parent[root2] = root1
        if self.rank[root1] == self.rank[root2]:
            self.rank[root1] += 1
            
        # Merge group sets
        self.groups[root1].update(self.groups[root2])
        del self.groups[root2]
        
        return True
    
    def get_groups(self) -> List[Set[str]]:
        """Get all disjoint groups"""
        return list(self.groups.values())

    def get_group(self, node: str) -> Set[str]:
        """Get the group set that contains the given node.

        Falls back to a singleton set if the node is unknown to the DSU.
        """
        if node not in self.parent:
            return {node}
        root = self.find(node)
        return self.groups.get(root, {node})

class SupernodeReconstructor:
    """Main class for automated supernode reconstruction"""
    
    def __init__(self, config: ReconstructionConfig):
        self.config = config
        self.fingerprints: Dict[str, NodeFingerprint] = {}
        self.merge_log: List[Dict[str, Any]] = []
        
    def compute_fingerprints(self, attribution_graph: Dict[str, Any]) -> Dict[str, NodeFingerprint]:
        """
        Compute L2-normalized fingerprints for all nodes based on logit influence patterns.

        Robustly parse common schemas and only build fingerprints over detected
        (target) logits. If fewer than 2 logits exist, produce empty fingerprints
        to avoid degenerate 1-D similarity.
        """
        fingerprints: Dict[str, NodeFingerprint] = {}
        # Pull nodes/edges with common fallbacks
        nodes = (
            attribution_graph.get('nodes')
            or attribution_graph.get('Vertices')
            or attribution_graph.get('NODES')
            or attribution_graph.get('graph', {}).get('nodes')
            or []
        )
        edges = (
            attribution_graph.get('edges')
            or attribution_graph.get('Edges')
            or attribution_graph.get('EDGES')
            or attribution_graph.get('links')
            or attribution_graph.get('Links')
            or attribution_graph.get('graph', {}).get('edges')
            or attribution_graph.get('graph', {}).get('Edges')
            or attribution_graph.get('graph', {}).get('EDGES')
            or attribution_graph.get('graph', {}).get('links')
            or attribution_graph.get('graph', {}).get('Links')
            or []
        )

        logger.info(f"compute_fingerprints: nodes={len(nodes)} edges={len(edges)}")

        # Helpers to robustly parse common schemas
        id_aliases = (
            'node_id', 'nodeId', 'id', 'jsNodeId', 'jsnodeid', 'feature_id', 'featureId', 'feature'
        )
        def _node_id(n: Dict[str, Any]) -> Optional[str]:
            for k in id_aliases:
                if k in n and n.get(k) is not None:
                    return str(n.get(k))
            return None

        def _node_layer(n: Dict[str, Any]) -> str:
            for k in ('layer', 'L', 'layer_index', 'layerIndex'):
                if k in n and n.get(k) is not None:
                    try:
                        return str(int(n.get(k)))
                    except Exception:
                        pass
            return '0'

        def _is_logit(n: Dict[str, Any]) -> bool:
            if bool(n.get('is_target_logit')):
                return True
            t = n.get('type') or n.get('feature_type') or n.get('node_type') or n.get('kind')
            if isinstance(t, str) and t.lower() == 'logit':
                return True
            rid = str(n.get('id', '')).lower()
            return 'logit' in rid

        def _edge_src(e: Dict[str, Any]) -> Optional[str]:
            for k in ('source', 'src', 'u', 'from', 's'):
                if k in e and e.get(k) is not None:
                    return str(e.get(k))
            return None

        def _edge_tgt(e: Dict[str, Any]) -> Optional[str]:
            for k in ('target', 'dst', 'v', 'to', 't'):
                if k in e and e.get(k) is not None:
                    return str(e.get(k))
            return None

        def _edge_w(e: Dict[str, Any]) -> float:
            for k in ('weight', 'w', 'score', 'influence'):
                if k in e and e.get(k) is not None:
                    return _safe_float(e.get(k), 0.0)
            return 0.0

        # Index edges by source once to avoid O(N*E) scanning per node
        t0 = time.perf_counter()
        edges_by_src: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for e in edges:
            s = _edge_src(e)
            if s is not None:
                edges_by_src[str(s)].append(e)
        t1 = time.perf_counter()
        logger.info(f"Indexed edges by source: {len(edges_by_src)} sources in {(t1 - t0):.3f}s")

        # Index nodes by id
        node_by_id: Dict[str, Dict[str, Any]] = {}
        for n in nodes:
            nid = _node_id(n)
            if nid is not None:
                node_by_id[nid] = n

        # Detect logits and build index
        logit_ids: List[str] = []
        for n in nodes:
            nid = _node_id(n)
            if nid is None:
                continue
            if _is_logit(n):
                logit_ids.append(nid)
        logit_index: Dict[str, int] = {lid: j for j, lid in enumerate(logit_ids)}
        D = len(logit_index)

        logger.info(f"compute_fingerprints: detected {D} logits for fingerprint dimension")

        # Build fingerprints
        zero_fingerprints = 0
        empty_fingerprints = 0
        nodes_with_edges = 0
        
        for n in nodes:
            nid = _node_id(n)
            if nid is None:
                continue
            layer = _node_layer(n)
            feature_type = str(n.get('feature_type') or n.get('type') or 'unknown')

            # Skip fingerprinting for logit nodes
            if _is_logit(n) or D < 2:
                vec = np.array([], dtype=float)
                empty_fingerprints += 1
            else:
                acc = np.zeros((D,), dtype=float)
                edge_count = 0
                outgoing = edges_by_src.get(nid, [])
                for e in outgoing:
                    t = _edge_tgt(e)
                    if t in logit_index:
                        w = _edge_w(e)
                        # Only multiply by activation if present; else use weight directly
                        logit_act = node_by_id.get(t, {}).get('activation', None)
                        if logit_act is not None:
                            acc[logit_index[t]] += w * _safe_float(logit_act, 1.0)
                        else:
                            acc[logit_index[t]] += w
                        edge_count += 1
                
                if edge_count > 0:
                    nodes_with_edges += 1
                
                vec = acc
                
                # Check if fingerprint is all zeros before normalization
                if np.allclose(vec, 0):
                    zero_fingerprints += 1

            # L2 normalize
            if vec.size > 0:
                nrm = np.linalg.norm(vec)
                if nrm > 0:
                    vec = vec / nrm

            fingerprints[nid] = NodeFingerprint(
                node_id=nid,
                layer=layer,
                feature_type=feature_type,
                fingerprint=vec,
                original_influence=_safe_float(n.get('influence', 0.0)),
            )
        
        logger.info(f"Fingerprint stats: {zero_fingerprints} zero vectors, {empty_fingerprints} empty vectors, {nodes_with_edges} nodes had edges to logits")

        self.fingerprints = fingerprints
        return fingerprints
    
    def propose_candidates(self, fingerprints: Dict[str, NodeFingerprint]) -> List[MergeCandidate]:
        """
        Propose merge candidates based on cosine similarity >= tau_sim
        Only considers intra-layer pairs if intra_layer_only is True
        """
        t_start = time.perf_counter()
        candidates: List[MergeCandidate] = []
        items: List[NodeFingerprint] = list(fingerprints.values())

        # Filter to informative vectors (>=2-D, non-zero norm, and non-constant)
        valid = []
        zero_norm_count = 0
        constant_vector_count = 0
        
        for fp in items:
            if fp.fingerprint.size < 2:
                continue
            
            norm = np.linalg.norm(fp.fingerprint)
            if norm == 0:
                zero_norm_count += 1
                continue
            
            # Check if vector is constant (all elements the same - no discrimination power)
            if np.var(fp.fingerprint) < 1e-10:
                constant_vector_count += 1
                continue
                
            valid.append(fp)
        
        logger.info(
            f"propose_candidates: {len(valid)}/{len(items)} fingerprints are informative"
        )
        logger.info(
            f"  Filtered out: {zero_norm_count} zero vectors, {constant_vector_count} constant vectors"
        )
        
        # Check for duplicate fingerprints (potential issue)
        if valid:
            fp_hashes = {}
            for fp in valid:
                fp_hash = hash(fp.fingerprint.tobytes())
                if fp_hash not in fp_hashes:
                    fp_hashes[fp_hash] = []
                fp_hashes[fp_hash].append(fp.node_id)
            
            duplicates = [(h, nodes) for h, nodes in fp_hashes.items() if len(nodes) > 1]
            if duplicates:
                logger.warning(f"Found {len(duplicates)} groups of nodes with IDENTICAL fingerprints!")
                total_duplicate_nodes = sum(len(nodes) for _, nodes in duplicates)
                logger.warning(f"  Total nodes with duplicates: {total_duplicate_nodes}")
                
                # DON'T propose merges for large duplicate groups - likely a data issue
                for h, nodes in list(fp_hashes.items()):
                    if len(nodes) > self.config.max_duplicate_group_size:
                        logger.warning(f"  Skipping duplicate group with {len(nodes)} nodes (exceeds max {self.config.max_duplicate_group_size})")
                        # Remove these from valid to prevent mass merging
                        valid = [fp for fp in valid if fp.node_id not in nodes]

        # Optionally restrict to intra-layer pairs efficiently
        if self.config.intra_layer_only:
            layer_map: Dict[str, List[NodeFingerprint]] = defaultdict(list)
            for fp in valid:
                layer_map[str(fp.layer)].append(fp)
            iter_groups = layer_map.values()
            
            # Log layer distribution
            layer_stats = {layer: len(fps) for layer, fps in layer_map.items()}
            logger.info(f"Layer distribution of valid fingerprints: {layer_stats}")
        else:
            iter_groups = [valid]

        # Track similarity distribution lazily
        high_sims_min = None
        high_sims_max = None

        for group in iter_groups:
            n = len(group)
            if n < 2:
                continue

            # Stack fingerprints into a matrix (assumed normalized where possible)
            try:
                X = np.stack([fp.fingerprint for fp in group], axis=0)
            except Exception:
                # Fallback to pair loop if stacking fails (should be rare)
                X = None

            layer_candidates = 0
            if X is not None and X.ndim == 2 and X.shape[1] >= 2:
                # Compute cosine similarities via dot product (fingerprints are L2-normalized)
                # Use float64 for numerical stability
                X = X.astype(np.float64, copy=False)
                S = X @ X.T
                # Ignore self-similarities
                np.fill_diagonal(S, -1.0)
                # Threshold and take upper triangle indices
                ii, jj = np.where(S >= float(self.config.tau_sim))
                sel = ii < jj
                ii, jj = ii[sel], jj[sel]
                for a, b in zip(ii.tolist(), jj.tolist()):
                    sim = float(S[a, b])
                    if high_sims_min is None or sim < high_sims_min:
                        high_sims_min = sim
                    if high_sims_max is None or sim > high_sims_max:
                        high_sims_max = sim
                    fp1, fp2 = group[a], group[b]
                    candidates.append(
                        MergeCandidate(
                            node1_id=fp1.node_id,
                            node2_id=fp2.node_id,
                            similarity=sim,
                            layer=str(fp1.layer),
                        )
                    )
                layer_candidates = len(ii)
            else:
                # Degenerate case: fall back to safe pair loop
                for i in range(n):
                    for j in range(i + 1, n):
                        fp1, fp2 = group[i], group[j]
                        if fp1.fingerprint.size != fp2.fingerprint.size or fp1.fingerprint.size < 2:
                            continue
                        try:
                            sim = 1 - cosine(fp1.fingerprint, fp2.fingerprint)
                        except Exception:
                            continue
                        if not np.isfinite(sim):
                            continue
                        if sim >= self.config.tau_sim:
                            if high_sims_min is None or sim < high_sims_min:
                                high_sims_min = sim
                            if high_sims_max is None or sim > high_sims_max:
                                high_sims_max = sim
                            candidates.append(
                                MergeCandidate(
                                    node1_id=fp1.node_id,
                                    node2_id=fp2.node_id,
                                    similarity=float(sim),
                                    layer=str(fp1.layer),
                                )
                            )
                            layer_candidates += 1

            total_pairs = n * (n - 1) // 2
            logger.info(f"Layer {group[0].layer if n else 'NA'}: {layer_candidates}/{total_pairs} pairs exceed tau_sim")

        if high_sims_min is not None and high_sims_max is not None:
            logger.info(f"High similarity pairs: min={high_sims_min:.4f}, max={high_sims_max:.4f}, count={len(candidates)}")

        logger.info(f"Proposed {len(candidates)} merge candidates with tau_sim >= {self.config.tau_sim} in {(time.perf_counter() - t_start):.3f}s")
        return candidates
    
    def fidelity_gate(self, candidates: List[MergeCandidate], 
                     attribution_graph: Dict[str, Any]) -> List[MergeCandidate]:
        """
        Apply fidelity gate: mean correlation >= alpha and CE gap <= beta
        """
        filtered_candidates = []
        failed_correlation = 0
        failed_ce_gap = 0
        failed_both = 0
        
        for candidate in candidates:
            fp1 = self.fingerprints[candidate.node1_id]
            fp2 = self.fingerprints[candidate.node2_id]
            
            # Compute mean correlation only for informative (>=2-D) vectors
            if (
                fp1.fingerprint.size == fp2.fingerprint.size
                and fp1.fingerprint.size >= 2
            ):
                # Check if fingerprints have variance (avoid division by zero in corrcoef)
                var1 = np.var(fp1.fingerprint)
                var2 = np.var(fp2.fingerprint)
                
                if var1 > 0 and var2 > 0:
                    correlation = np.corrcoef(fp1.fingerprint, fp2.fingerprint)[0, 1]
                    if np.isnan(correlation):
                        correlation = 0.0
                else:
                    # If either has no variance, they're constant vectors
                    correlation = 1.0 if np.allclose(fp1.fingerprint, fp2.fingerprint) else 0.0
            else:
                correlation = 0.0
            
            # Simplified CE gap computation (difference in influence magnitudes)
            ce_gap = abs(fp1.original_influence - fp2.original_influence)
            
            # Track failure reasons
            corr_pass = correlation >= self.config.alpha
            ce_pass = ce_gap <= self.config.beta
            
            if not corr_pass and not ce_pass:
                failed_both += 1
            elif not corr_pass:
                failed_correlation += 1
            elif not ce_pass:
                failed_ce_gap += 1
            
            # Apply fidelity gates
            if corr_pass and ce_pass:
                filtered_candidates.append(candidate)
                
        logger.info(f"Fidelity gate results: {len(filtered_candidates)}/{len(candidates)} passed")
        logger.info(f"  Failed correlation only: {failed_correlation}, Failed CE gap only: {failed_ce_gap}, Failed both: {failed_both}")
        return filtered_candidates
    
    def merge_and_rewire(self, candidates: List[MergeCandidate], 
                        attribution_graph: Dict[str, Any]) -> Tuple[List[SupernodeGroup], Dict[str, Any]]:
        """
        Merge candidates using DSU and rewire the graph
        """
        # Pull nodes/edges with common fallbacks
        nodes = (
            attribution_graph.get('nodes')
            or attribution_graph.get('Vertices')
            or attribution_graph.get('NODES')
            or attribution_graph.get('graph', {}).get('nodes')
            or []
        )
        edges = (
            attribution_graph.get('edges')
            or attribution_graph.get('Edges')
            or attribution_graph.get('EDGES')
            or attribution_graph.get('links')
            or attribution_graph.get('Links')
            or attribution_graph.get('graph', {}).get('edges')
            or attribution_graph.get('graph', {}).get('Edges')
            or attribution_graph.get('graph', {}).get('EDGES')
            or attribution_graph.get('graph', {}).get('links')
            or attribution_graph.get('graph', {}).get('Links')
            or []
        )

        id_aliases = (
            'node_id', 'nodeId', 'id', 'jsNodeId', 'jsnodeid', 'feature_id', 'featureId', 'feature'
        )
        def _node_id(n: Dict[str, Any]) -> Optional[str]:
            for k in id_aliases:
                if k in n and n.get(k) is not None:
                    return str(n.get(k))
            return None

        # Initialize DSU with all node IDs we can resolve
        node_ids = [nid for nid in (_node_id(n) for n in nodes) if nid is not None]
        dsu = DisjointSetUnion(node_ids)

        # Merge candidates with size limit
        # Track current group sizes to prevent excessive merging
        successful_merges = 0
        for candidate in candidates:
            # Check if merging would create a group that's too large
            group1_size = len(dsu.get_group(candidate.node1_id))
            group2_size = len(dsu.get_group(candidate.node2_id))
            
            if group1_size + group2_size <= self.config.max_supernode_size:
                if dsu.union(candidate.node1_id, candidate.node2_id):
                    successful_merges += 1
                    self.merge_log.append({
                        'node1': candidate.node1_id,
                        'node2': candidate.node2_id,
                        'similarity': candidate.similarity,
                        'layer': candidate.layer
                    })
            else:
                logger.debug(f"Skipped merge: would create supernode of size {group1_size + group2_size} (max: {self.config.max_supernode_size})")
        
        logger.info(f"Successfully merged {successful_merges} out of {len(candidates)} candidates")
        
        # Create supernode groups
        groups = dsu.get_groups()
        supernode_groups = []
        
        for i, group in enumerate(groups):
            if len(group) > 1:  # Only create supernodes for merged groups
                members = list(group)
                
                # Compute group properties
                member_nodes = []
                for n in nodes:
                    nid = _node_id(n)
                    if nid in members:
                        member_nodes.append(n)
                # Layer as string for consistency
                layer = str(member_nodes[0].get('layer', '0')) if member_nodes else '0'
                mean_influence = float(np.mean([_safe_float(n.get('influence', 0.0)) for n in member_nodes])) if member_nodes else 0.0
                
                # Compute merged fingerprint (mean of member fingerprints)
                member_fingerprints = [self.fingerprints[mid].fingerprint for mid in members]
                if member_fingerprints and len(member_fingerprints[0]) > 0:
                    merged_fingerprint = np.mean(member_fingerprints, axis=0)
                    # Renormalize
                    if np.linalg.norm(merged_fingerprint) > 0:
                        merged_fingerprint = merged_fingerprint / np.linalg.norm(merged_fingerprint)
                else:
                    merged_fingerprint = np.array([])
                
                supernode_groups.append(SupernodeGroup(
                    id=f"supernode_{i}",
                    members=members,
                    layer=layer,
                    size=len(members),
                    mean_influence=mean_influence,
                    fingerprint=merged_fingerprint
                ))
        
        # Rewire edges (simplified - keep original edges for now)
        rewired_graph = {
            'nodes': nodes,
            'edges': edges,
            'supernodes': [
                {
                    'id': sg.id,
                    'members': sg.members,
                    'layer': sg.layer,
                    'size': sg.size,
                    'mean_influence': sg.mean_influence
                }
                for sg in supernode_groups
            ]
        }
        
        logger.info(f"Created {len(supernode_groups)} supernodes from {successful_merges} merges")
        return supernode_groups, rewired_graph
    
    def reconstruct_supernodes(self, attribution_graph: Dict[str, Any]) -> Dict[str, Any]:
        """
        Main reconstruction pipeline
        """
        logger.info("Starting automated supernode reconstruction")
        t0 = time.perf_counter()
        
        # Step 1: Compute fingerprints
        t_fp0 = time.perf_counter()
        fingerprints = self.compute_fingerprints(attribution_graph)
        t_fp1 = time.perf_counter()
        logger.info(f"Step 1 done: compute_fingerprints in {(t_fp1 - t_fp0):.3f}s")
        
        # Step 2: Propose candidates
        t_pc0 = time.perf_counter()
        candidates = self.propose_candidates(fingerprints)
        t_pc1 = time.perf_counter()
        logger.info(f"Step 2 done: propose_candidates in {(t_pc1 - t_pc0):.3f}s")
        
        # Step 3: Apply fidelity gate
        t_fg0 = time.perf_counter()
        filtered_candidates = self.fidelity_gate(candidates, attribution_graph)
        t_fg1 = time.perf_counter()
        logger.info(f"Step 3 done: fidelity_gate in {(t_fg1 - t_fg0):.3f}s")
        
        # Step 4: Merge and rewire
        t_mr0 = time.perf_counter()
        supernode_groups, rewired_graph = self.merge_and_rewire(filtered_candidates, attribution_graph)
        t_mr1 = time.perf_counter()
        logger.info(f"Step 4 done: merge_and_rewire in {(t_mr1 - t_mr0):.3f}s")
        
        # Compute compression ratio using robust node access
        nodes_for_count = (
            attribution_graph.get('nodes')
            or attribution_graph.get('Vertices')
            or attribution_graph.get('NODES')
            or attribution_graph.get('graph', {}).get('nodes')
            or []
        )
        original_nodes = len(nodes_for_count)
        final_nodes = original_nodes - sum(sg.size - 1 for sg in supernode_groups)
        compression_ratio = original_nodes / final_nodes if final_nodes > 0 else 1.0
        
        result = {
            'supernodes': rewired_graph.get('supernodes', []),
            'rewired_graph': rewired_graph,
            'merge_log': self.merge_log,
            'stats': {
                'original_nodes': original_nodes,
                'final_nodes': final_nodes,
                'compression_ratio': compression_ratio,
                'num_supernodes': len(supernode_groups),
                'candidates_proposed': len(candidates),
                'candidates_passed_gate': len(filtered_candidates)
            }
        }
        
        logger.info(f"Reconstruction complete: {len(supernode_groups)} supernodes, CR={compression_ratio:.2f}, total={(time.perf_counter() - t0):.3f}s")
        return result

    # ---------------------------
    # Target-conditioned ultranode
    # ---------------------------
    @dataclass
    class UltranodeConfig:
        prefilter_topk: int = 200
        ablation_mode: str = "zero"  # placeholder only (no model-backed ablation yet)
        node_thresh: float = 0.0
        edge_thresh: float = 0.0
        kpaths: int = 5
        use_pcst: bool = False
        include_negative: bool = False
        max_nodes: int = 150
        max_hops: int = 2
        top_k_seeds: int = 25
        top_k_per_hop: int = 10
        alpha: float = 0.95
        beta: float = 0.02

    def _aggregate_supergraph(self, attribution_graph: Dict[str, Any], node_to_group: Dict[str, str]) -> Dict[str, Any]:
        """Aggregate original graph into a group-level supergraph using the provided mapping.

        Returns dict with:
          - group_nodes: {gid: {members, layer, mean_influence, fingerprint}}
          - gg_edges: list of {source, target, weight}
          - gl_edges: list of {source, logit, weight}
          - logit_ids: list of logit node ids
        """
        # Pull nodes/edges as in other methods
        nodes = (
            attribution_graph.get('nodes')
            or attribution_graph.get('Vertices')
            or attribution_graph.get('NODES')
            or attribution_graph.get('graph', {}).get('nodes')
            or []
        )
        edges = (
            attribution_graph.get('edges')
            or attribution_graph.get('Edges')
            or attribution_graph.get('EDGES')
            or attribution_graph.get('links')
            or attribution_graph.get('Links')
            or attribution_graph.get('graph', {}).get('edges')
            or attribution_graph.get('graph', {}).get('Edges')
            or attribution_graph.get('graph', {}).get('EDGES')
            or attribution_graph.get('graph', {}).get('links')
            or attribution_graph.get('graph', {}).get('Links')
            or []
        )

        # Helpers duplicate (kept local to avoid refactor churn)
        id_aliases = (
            'node_id', 'nodeId', 'id', 'jsNodeId', 'jsnodeid', 'feature_id', 'featureId', 'feature'
        )
        def _node_id(n: Dict[str, Any]) -> Optional[str]:
            for k in id_aliases:
                if k in n and n.get(k) is not None:
                    return str(n.get(k))
            return None
        def _node_layer(n: Dict[str, Any]) -> str:
            for k in ('layer', 'L', 'layer_index', 'layerIndex'):
                if k in n and n.get(k) is not None:
                    try:
                        return str(int(n.get(k)))
                    except Exception:
                        pass
            return '0'
        def _is_logit(n: Dict[str, Any]) -> bool:
            if bool(n.get('is_target_logit')):
                return True
            t = n.get('type') or n.get('feature_type') or n.get('node_type') or n.get('kind')
            if isinstance(t, str) and t.lower() == 'logit':
                return True
            rid = str(n.get('id', '')).lower()
            return 'logit' in rid
        def _edge_src(e: Dict[str, Any]) -> Optional[str]:
            for k in ('source', 'src', 'u', 'from', 's'):
                if k in e and e.get(k) is not None:
                    return str(e.get(k))
            return None
        def _edge_tgt(e: Dict[str, Any]) -> Optional[str]:
            for k in ('target', 'dst', 'v', 'to', 't'):
                if k in e and e.get(k) is not None:
                    return str(e.get(k))
            return None
        def _edge_w(e: Dict[str, Any]) -> float:
            for k in ('weight', 'w', 'score', 'influence'):
                if k in e and e.get(k) is not None:
                    return _safe_float(e.get(k), 0.0)
            return 0.0

        # Build group node info
        group_nodes: Dict[str, Dict[str, Any]] = {}
        members_by_gid: Dict[str, List[str]] = {}
        for n in nodes:
            nid = _node_id(n)
            if nid is None:
                continue
            gid = node_to_group.get(nid)
            if gid is None:
                continue
            members_by_gid.setdefault(gid, []).append(nid)

        # Compute per-group layer, mean_influence, fingerprint (reuse member fp means)
        for gid, members in members_by_gid.items():
            layers = []
            influences = []
            fps = []
            for mid in members:
                # recover original node record if present
                # layer default to member fingerprint layer if node dict missing
                fp = self.fingerprints.get(mid)
                if fp is not None:
                    layers.append(fp.layer)
                    influences.append(fp.original_influence)
                    if fp.fingerprint.size > 0:
                        fps.append(fp.fingerprint)
            layer = str(layers[0]) if layers else '0'
            mean_influence = float(np.mean(influences)) if influences else 0.0
            if fps:
                merged_fp = np.mean(np.stack(fps, axis=0), axis=0)
                nrm = np.linalg.norm(merged_fp)
                if nrm > 0:
                    merged_fp = merged_fp / nrm
            else:
                merged_fp = np.array([])
            group_nodes[gid] = {
                'members': members,
                'layer': layer,
                'mean_influence': mean_influence,
                'fingerprint': merged_fp,
            }

        # Collect logit ids
        logit_ids: List[str] = []
        for n in nodes:
            if _is_logit(n):
                nid = _node_id(n)
                if nid is not None:
                    logit_ids.append(nid)

        # Aggregate edges
        gg_acc: Dict[Tuple[str, str], float] = defaultdict(float)
        gl_acc: Dict[Tuple[str, str], float] = defaultdict(float)
        for e in edges:
            s = _edge_src(e)
            t = _edge_tgt(e)
            if s is None or t is None:
                continue
            w = _edge_w(e)
            sg = node_to_group.get(s)
            if t in logit_ids:
                if sg is not None:
                    gl_acc[(sg, t)] += float(w)
            else:
                tg = node_to_group.get(t)
                if sg is not None and tg is not None and sg != tg:
                    gg_acc[(sg, tg)] += float(w)

        gg_edges = [
            {'source': a, 'target': b, 'weight': float(w)} for (a, b), w in gg_acc.items()
        ]
        gl_edges = [
            {'source': a, 'logit': l, 'weight': float(w)} for (a, l), w in gl_acc.items()
        ]

        return {
            'group_nodes': group_nodes,
            'gg_edges': gg_edges,
            'gl_edges': gl_edges,
            'logit_ids': logit_ids,
        }

    def _score_target_proxy(self, supergraph: Dict[str, Any], target_logit_id: str, include_negative: bool) -> Tuple[Dict[str, float], Dict[Tuple[str, str], float]]:
        """Proxy target-conditioned scores using aggregated weights to the chosen logit.

        s_v (node scores) := max(0, weight(group -> target_logit)) unless include_negative
        s_e (edge scores) := max(0, weight) for group->group edges unless include_negative
        """
        node_scores: Dict[str, float] = {}
        edge_scores: Dict[Tuple[str, str], float] = {}
        # Node (group) scores from group->logit edges
        for e in supergraph['gl_edges']:
            if e['logit'] != target_logit_id:
                continue
            w = float(e['weight'])
            if include_negative:
                node_scores[e['source']] = node_scores.get(e['source'], 0.0) + w
            else:
                if w > 0:
                    node_scores[e['source']] = node_scores.get(e['source'], 0.0) + w
        # Edge scores from group->group edges
        for e in supergraph['gg_edges']:
            w = float(e['weight'])
            if include_negative:
                edge_scores[(e['source'], e['target'])] = w
            else:
                if w > 0:
                    edge_scores[(e['source'], e['target'])] = w
        return node_scores, edge_scores

    def _extract_bfs_subgraph(self, supergraph: Dict[str, Any], target_logit_id: str, node_scores: Dict[str, float], edge_scores: Dict[Tuple[str, str], float], *, max_nodes: int, max_hops: int, top_k_seeds: int, top_k_per_hop: int) -> Tuple[Set[str], Set[Tuple[str, str]], List[List[str]]]:
        """Fallback BFS expansion from top seed groups toward upstream contributors.

        Returns (selected_groups, selected_edges, paths) where paths end at target logit.
        """
        # Build adjacency maps
        incoming: Dict[str, List[Tuple[str, float]]] = defaultdict(list)
        for (u, v), w in edge_scores.items():
            incoming[v].append((u, w))
        # Only consider groups that connect to target directly as seeds
        seeds = sorted(
            [gid for gid in node_scores.keys()],
            key=lambda g: node_scores[g], reverse=True
        )[: max(1, top_k_seeds)]

        selected_nodes: Set[str] = set()
        selected_edges: Set[Tuple[str, str]] = set()
        paths: List[List[str]] = []

        for seed in seeds:
            if len(selected_nodes) >= max_nodes:
                break
            # Add seed and its direct edge to the target (conceptual path seed->logit)
            selected_nodes.add(seed)
            # BFS upstream up to max_hops
            frontier = [seed]
            parents: Dict[str, Optional[str]] = {seed: None}
            for _ in range(max_hops):
                next_frontier: List[str] = []
                for v in frontier:
                    # Pick top contributors into v
                    neighs = sorted(incoming.get(v, []), key=lambda x: x[1], reverse=True)[:top_k_per_hop]
                    for u, score in neighs:
                        if len(selected_nodes) >= max_nodes:
                            break
                        selected_nodes.add(u)
                        selected_edges.add((u, v))
                        if u not in parents:
                            parents[u] = v
                            next_frontier.append(u)
                frontier = next_frontier
                if not frontier:
                    break
            # Reconstruct a path from the farthest discovered back down to seed, then to logit
            # Choose the farthest node by depth (first discovered in last layer)
            farthest = seed
            depth_map: Dict[str, int] = {seed: 0}
            q = [seed]
            while q:
                x = q.pop()
                for u, _ in incoming.get(x, []):
                    if u in parents and u not in depth_map:
                        depth_map[u] = depth_map[x] + 1
                        q.append(u)
                        if depth_map[u] >= depth_map.get(farthest, 0):
                            farthest = u
            # Build one representative path
            path: List[str] = []
            cur = farthest
            visited_guard = set()
            while cur is not None and cur not in visited_guard:
                path.append(cur)
                visited_guard.add(cur)
                cur = parents.get(cur)
            path = list(reversed(path))
            # Append synthetic target logit as terminus
            path.append(target_logit_id)
            paths.append(path)

        return selected_nodes, selected_edges, paths

    def _compute_fidelity_summary(self, selected_groups: Set[str], group_nodes: Dict[str, Dict[str, Any]], alpha: float, beta: float) -> Dict[str, float]:
        """Compute simple fidelity proxies over selected groups to report (not gating selections).

        - mean_corr: mean pairwise correlation between group fingerprints (only where both non-empty)
        - ce_gap: mean absolute difference of mean_influence across pairs (proxy)
        """
        fps = [group_nodes[g]['fingerprint'] for g in selected_groups if isinstance(group_nodes[g].get('fingerprint'), np.ndarray)]
        infs = [float(group_nodes[g]['mean_influence']) for g in selected_groups]
        # mean pairwise correlation
        pair_corrs: List[float] = []
        for i in range(len(fps)):
            for j in range(i + 1, len(fps)):
                a, b = fps[i], fps[j]
                if a.size >= 2 and b.size == a.size and np.var(a) > 0 and np.var(b) > 0:
                    c = np.corrcoef(a, b)[0, 1]
                    if not np.isnan(c):
                        pair_corrs.append(float(c))
        mean_corr = float(np.mean(pair_corrs)) if pair_corrs else 1.0
        # proxy CE gap: mean absolute diff of normalized influences
        ce_vals: List[float] = []
        if len(infs) >= 2:
            norm = max(1e-9, max(abs(x) for x in infs))
            normed = [x / norm for x in infs]
            for i in range(len(normed)):
                for j in range(i + 1, len(normed)):
                    ce_vals.append(abs(normed[i] - normed[j]))
        ce_gap = float(np.mean(ce_vals)) if ce_vals else 0.0
        return {"mean_corr": mean_corr, "ce_gap": ce_gap, "alpha": float(alpha), "beta": float(beta)}

    def build_ultranode(self, attribution_graph: Dict[str, Any], target_logit_id: str, cfg_dict: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """End-to-end target-conditioned ultranode extraction.

        This implementation uses aggregated weights as a proxy for causal scores. It is deterministic
        given fixed inputs and seed (no RNG used here).
        """
        t0 = time.perf_counter()
        # 1) Run reconstruction to obtain groups and fingerprints populated
        recon_result = self.reconstruct_supernodes(attribution_graph)
        supernodes_info = recon_result.get('rewired_graph', {}).get('supernodes', [])

        # 2) Build mapping node_id -> group_id
        node_to_group: Dict[str, str] = {}
        for sn in supernodes_info:
            gid = sn.get('id')
            for mid in sn.get('members', []):
                node_to_group[str(mid)] = gid
        if not node_to_group:
            logger.warning("No supernodes created; ultranode will be empty")

        # 3) Aggregate to supergraph
        supergraph = self._aggregate_supergraph(attribution_graph, node_to_group)

        # 4) Target-conditioned scoring (proxy)
        cfg = self.UltranodeConfig(**(cfg_dict or {}))
        node_scores, edge_scores = self._score_target_proxy(supergraph, target_logit_id, include_negative=cfg.include_negative)

        # 5) Prefilter top-K group nodes by score
        if cfg.prefilter_topk > 0:
            top_nodes = sorted(node_scores.items(), key=lambda kv: kv[1], reverse=True)[: cfg.prefilter_topk]
            node_scores = {k: v for k, v in top_nodes}

        # 6) Extract subgraph via BFS (fallback method)
        selected_nodes, selected_edges, paths = self._extract_bfs_subgraph(
            supergraph,
            target_logit_id,
            node_scores,
            edge_scores,
            max_nodes=cfg.max_nodes,
            max_hops=cfg.max_hops,
            top_k_seeds=cfg.top_k_seeds,
            top_k_per_hop=cfg.top_k_per_hop,
        )

        # 7) Thresholding
        # Remove weak nodes/edges by score
        if cfg.node_thresh > 0.0:
            selected_nodes = {g for g in selected_nodes if node_scores.get(g, 0.0) >= cfg.node_thresh}
        if cfg.edge_thresh > 0.0:
            selected_edges = {e for e in selected_edges if edge_scores.get(e, 0.0) >= cfg.edge_thresh}

        # 8) Build response structures
        group_nodes = supergraph['group_nodes']
        nodes_resp = [
            {
                'id': gid,
                'score': float(node_scores.get(gid, 0.0)),
                'layer': int(group_nodes.get(gid, {}).get('layer', '0')) if str(group_nodes.get(gid, {}).get('layer', '0')).isdigit() else group_nodes.get(gid, {}).get('layer', '0'),
                'label': None,
                'members': group_nodes.get(gid, {}).get('members', []),
            }
            for gid in selected_nodes
        ]
        # Always include a node entry for the target logit as terminus (for front-end convenience)
        # Note: score for logit itself is the total incoming positive mass from selected nodes
        total_target_mass = float(sum(node_scores.get(g, 0.0) for g in selected_nodes))

        # Ensure all edges among selected nodes are included (not only BFS-chosen ones)
        # Add any group->group edges between selected nodes from the aggregated supergraph
        if supergraph.get('gg_edges'):
            for e in supergraph['gg_edges']:
                u, v = e.get('source'), e.get('target')
                if u in selected_nodes and v in selected_nodes:
                    w = float(e.get('weight', 0.0))
                    if not cfg.include_negative and w <= 0:
                        continue
                    selected_edges.add((u, v))

        # Build quick lookup for aggregated supergraph edge weights
        gg_weight_map: Dict[Tuple[str, str], float] = {}
        for e in supergraph.get('gg_edges', []):
            try:
                a, b = str(e.get('source')), str(e.get('target'))
                gg_weight_map[(a, b)] = float(e.get('weight', 0.0))
            except Exception:
                continue

        edges_resp = []
        for (u, v) in selected_edges:
            # Prefer target-conditioned edge_scores; fall back to aggregated supergraph weight
            w = float(edge_scores.get((u, v), gg_weight_map.get((u, v), 0.0)))
            edges_resp.append({'source': u, 'target': v, 'score': w, 'sign': 'pos'})
        # Also include edges from selected groups to the target logit
        for e in supergraph['gl_edges']:
            if e['logit'] == target_logit_id and e['source'] in selected_nodes:
                w = float(e['weight'])
                if not cfg.include_negative and w <= 0:
                    continue
                edges_resp.append({'source': e['source'], 'target': target_logit_id, 'score': float(abs(w)), 'sign': ('pos' if w >= 0 else 'neg')})

        # 9) Fidelity summary over selected groups (proxy, informational)
        fidelity = self._compute_fidelity_summary(selected_nodes, group_nodes, cfg.alpha, cfg.beta)

        # 10) Stats
        all_mass = float(sum(max(0.0, v) for v in node_scores.values())) if not cfg.include_negative else float(sum(abs(v) for v in node_scores.values()))
        captured_pct = (total_target_mass / all_mass) * 100.0 if all_mass > 0 else 0.0
        stats = {
            'total_causal_mass': total_target_mass,
            'captured_mass_pct': captured_pct,
            'num_nodes': len(selected_nodes),
            'num_edges': len(edges_resp),
            'compression': (len(supergraph['group_nodes']) / max(1, len(selected_nodes))) if selected_nodes else 1.0,
        }

        logger.info(
            f"Ultranode(target={target_logit_id}): nodes={stats['num_nodes']} edges={stats['num_edges']} mass={total_target_mass:.4f} captured={captured_pct:.1f}%"
        )

        return {
            'selected_logit_id': target_logit_id,
            'nodes': nodes_resp,
            'edges': edges_resp,
            'paths': paths,
            'fidelity_after_selection': fidelity,
            'stats': stats,
        }
