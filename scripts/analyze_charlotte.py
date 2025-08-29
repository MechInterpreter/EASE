#!/usr/bin/env python3
"""
Analyze the Charlotte dataset to understand node distribution across layers.
Adds an optional streaming mode using ijson to handle very large JSON files.
"""
import json
from pathlib import Path
from collections import defaultdict
from typing import Dict, List, Tuple, Optional
import sys
import argparse
import os

def load_dataset(path: Path) -> Tuple[Dict, List[Dict], List[Dict]]:
    """Load the dataset from the given path with progress feedback."""
    print(f"Loading dataset from {path}...")
    try:
        with open(path, 'r', encoding='utf-8') as f:
            print("Parsing JSON...")
            data = json.load(f)
        
        print("Extracting nodes and edges...")
        # Extract nodes and edges/links using common keys
        nodes = data.get('nodes') or data.get('Vertices') or data.get('NODES') or []
        edges = (
            data.get('edges') or data.get('Edges') or data.get('EDGES') or
            data.get('links') or data.get('Links') or []
        )
        
        if not nodes and 'graph' in data:
            print("Found nested graph structure...")
            graph_data = data['graph']
            nodes = graph_data.get('nodes') or graph_data.get('Vertices') or graph_data.get('NODES') or nodes
            edges = (
                graph_data.get('edges') or graph_data.get('Edges') or graph_data.get('EDGES') or
                graph_data.get('links') or graph_data.get('Links') or edges
            )
        
        print(f"Loaded {len(nodes)} nodes and {len(edges)} edges")
        return data, nodes, edges
        
    except Exception as e:
        print(f"Error loading dataset: {e}")
        raise

def analyze_nodes(nodes: List[Dict]) -> Dict:
    """Analyze node distribution across layers and types with progress feedback."""
    print("Analyzing nodes...")
    layer_counts = defaultdict(int)
    type_counts = defaultdict(int)
    num_target_logits = 0
    num_with_influence = 0
    num_with_activation = 0
    
    total_nodes = len(nodes)
    print(f"Processing {total_nodes} nodes...")
    
    for i, node in enumerate(nodes, 1):
        if i % 100 == 0 or i == total_nodes:
            print(f"  Processed {i}/{total_nodes} nodes...")
            
        # Get layer, defaulting to -1 if not present; coerce to int when possible
        raw_layer = node.get('layer', -1)
        layer = -1
        if raw_layer is not None:
            try:
                layer = int(raw_layer)
            except Exception:
                layer = -1
        
        # Get node type; prefer feature_type if type missing
        node_type = node.get('type') or node.get('feature_type') or 'unknown'
        
        # Count target logits and presence of scalar fields
        if node.get('is_target_logit', False):
            num_target_logits += 1
        if 'influence' in node:
            try:
                if float(node.get('influence') or 0.0) != 0.0:
                    num_with_influence += 1
            except Exception:
                pass
        if 'activation' in node:
            try:
                if float(node.get('activation') or 0.0) != 0.0:
                    num_with_activation += 1
            except Exception:
                pass
        
        # Count nodes per layer and type
        layer_counts[layer] += 1
        type_counts[node_type] += 1
    
    print("Node analysis complete")
    return {
        'layer_counts': dict(sorted(layer_counts.items())),
        'type_counts': dict(sorted(type_counts.items())),
        'total_nodes': total_nodes,
        'num_target_logits': num_target_logits,
        'num_with_influence': num_with_influence,
        'num_with_activation': num_with_activation,
    }

def analyze_edges(edges: List[Dict]) -> Dict:
    """Analyze edge statistics (list-based)."""
    if not edges:
        return {
            'total_edges': 0,
            'has_weights': False,
            'edges_with_weights': 0,
            'edges_without_weights': 0
        }

    weight_keys = ('weight', 'w', 'score', 'influence')
    def _has_w(e: Dict) -> bool:
        return any(k in e for k in weight_keys)

    has_weights = any(_has_w(edge) for edge in edges)
    edges_with_weights = sum(1 for e in edges if _has_w(e))

    return {
        'total_edges': len(edges),
        'has_weights': has_weights,
        'edges_with_weights': edges_with_weights,
        'edges_without_weights': len(edges) - edges_with_weights
    }


def stream_analyze(path: Path, max_nodes: Optional[int] = None, max_edges: Optional[int] = None) -> Tuple[Optional[Dict], Optional[Dict]]:
    """Stream-parse nodes and edges using ijson if available. Returns (node_stats, edge_stats) or (None, None) if ijson missing.

    This avoids loading the entire JSON into memory and works with either top-level
    arrays or nested under a 'graph' object. It tries multiple common key variants.
    """
    try:
        import ijson  # type: ignore
    except Exception:
        print("ijson not available; falling back to full JSON load. Run `pip install ijson` for streaming.")
        return None, None

    node_layer_counts = defaultdict(int)
    node_type_counts = defaultdict(int)
    num_target_logits = 0
    num_with_influence = 0
    num_with_activation = 0
    total_nodes = 0

    total_edges = 0
    has_weights = False
    edges_with_weights = 0

    node_paths = [
        'nodes.item', 'Vertices.item', 'NODES.item',
        'graph.nodes.item', 'graph.Vertices.item', 'graph.NODES.item',
    ]
    edge_paths = [
        'edges.item', 'Edges.item', 'EDGES.item',
        'links.item', 'Links.item',
        'graph.edges.item', 'graph.Edges.item', 'graph.EDGES.item',
        'graph.links.item', 'graph.Links.item',
    ]

    def _iter_items(p: Path, jpath: str):
        with open(p, 'rb') as f:
            for obj in ijson.items(f, jpath):
                yield obj

    # Stream nodes
    nodes_streamed = False
    for jpath in node_paths:
        count_here = 0
        try:
            for node in _iter_items(path, jpath):
                nodes_streamed = True
                total_nodes += 1
                count_here += 1
                # Layer
                layer = -1
                raw_layer = node.get('layer', -1)
                if raw_layer is not None:
                    try:
                        layer = int(raw_layer)
                    except Exception:
                        layer = -1
                node_layer_counts[layer] += 1
                # Type
                node_type = node.get('type') or node.get('feature_type') or 'unknown'
                node_type_counts[node_type] += 1
                # Target logit
                if node.get('is_target_logit', False):
                    num_target_logits += 1
                # Scalar fields
                try:
                    if float(node.get('influence') or 0.0) != 0.0:
                        num_with_influence += 1
                except Exception:
                    pass
                try:
                    if float(node.get('activation') or 0.0) != 0.0:
                        num_with_activation += 1
                except Exception:
                    pass
                if max_nodes and count_here >= max_nodes:
                    break
        except Exception:
            continue
        if count_here > 0:
            break

    # Stream edges
    edges_streamed = False
    weight_keys = ('weight', 'w', 'score', 'influence')
    for jpath in edge_paths:
        count_here = 0
        try:
            for e in _iter_items(path, jpath):
                edges_streamed = True
                total_edges += 1
                if any(k in e for k in weight_keys):
                    has_weights = True
                    edges_with_weights += 1
                count_here += 1
                if max_edges and count_here >= max_edges:
                    break
        except Exception:
            continue
        if count_here > 0:
            break

    node_stats = {
        'layer_counts': dict(sorted(node_layer_counts.items())),
        'type_counts': dict(sorted(node_type_counts.items())),
        'total_nodes': total_nodes,
        'num_target_logits': num_target_logits,
        'num_with_influence': num_with_influence,
        'num_with_activation': num_with_activation,
    } if nodes_streamed else None

    edge_stats = {
        'total_edges': total_edges,
        'has_weights': has_weights,
        'edges_with_weights': edges_with_weights,
        'edges_without_weights': max(0, total_edges - edges_with_weights),
    } if edges_streamed else None

    return node_stats, edge_stats

def main():
    parser = argparse.ArgumentParser(description="Analyze the Charlotte dataset (streaming-friendly)")
    parser.add_argument('--path', type=str, default=str(Path(__file__).parent.parent / 'data' / 'charlotte_neuronpedia.json'), help='Path to dataset JSON')
    parser.add_argument('--stream', action='store_true', help='Force streaming mode using ijson')
    parser.add_argument('--max-nodes', type=int, default=None, help='Max nodes to process in streaming mode')
    parser.add_argument('--max-edges', type=int, default=None, help='Max edges to process in streaming mode')
    args = parser.parse_args()

    data_path = Path(args.path)

    if not data_path.exists():
        print(f"Error: Dataset not found at {data_path}")
        sys.exit(1)

    print(f"Analyzing dataset: {data_path}")

    # Auto-enable streaming for very large files unless explicitly disabled
    use_stream = args.stream
    try:
        size_mb = os.path.getsize(data_path) / (1024 * 1024)
        if size_mb > 200 and not use_stream:
            print(f"File is large (~{size_mb:.1f} MB). Attempting streaming mode...")
            use_stream = True
    except Exception:
        pass

    try:
        node_stats = None
        edge_stats = None
        if use_stream:
            node_stats, edge_stats = stream_analyze(data_path, max_nodes=args.max_nodes, max_edges=args.max_edges)
            if args.stream and (node_stats is None or edge_stats is None):
                print("Streaming requested but ijson is not available. Please install it: pip install ijson")
                sys.exit(2)

        if node_stats is None or edge_stats is None:
            # Fallback: load into memory
            data, nodes, edges = load_dataset(data_path)
            node_stats = analyze_nodes(nodes)
            edge_stats = analyze_edges(edges)

        # Print results
        print("\n=== Node Statistics ===")
        print(f"Total nodes: {node_stats['total_nodes']}")

        print("\nNodes by type:")
        for node_type, count in node_stats['type_counts'].items():
            print(f"  {node_type}: {count}")

        print("\nNodes by layer:")
        for layer, count in node_stats['layer_counts'].items():
            print(f"  Layer {layer}: {count}")

        print("\nOther node fields:")
        print(f"  Target logits: {node_stats['num_target_logits']}")
        print(f"  Nodes with nonzero 'influence': {node_stats['num_with_influence']}")
        print(f"  Nodes with nonzero 'activation': {node_stats['num_with_activation']}")

        print("\n=== Edge Statistics ===")
        print(f"Total edges: {edge_stats['total_edges']}")
        if edge_stats['has_weights']:
            print(f"Edges with weights: {edge_stats['edges_with_weights']}")
            print(f"Edges without weights: {edge_stats['edges_without_weights']}")

        # Check for layer 0 specifically
        layer_0_count = node_stats['layer_counts'].get(0, 0)
        print(f"\n=== Layer 0 Analysis ===")
        print(f"Nodes in Layer 0: {layer_0_count}")
        if layer_0_count > 0:
            print("Layer 0 contains nodes and will be processed during supernode reconstruction.")
        else:
            print("Warning: No nodes found in Layer 0. This may affect supernode reconstruction.")

    except Exception as e:
        print(f"Error analyzing dataset: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
