from __future__ import annotations

import hashlib
from typing import Iterable, Tuple

import numpy as np


def l2_normalize_rows(X: np.ndarray, eps: float = 1e-8) -> np.ndarray:
    norms = np.linalg.norm(X, axis=1, keepdims=True)
    norms = np.maximum(norms, eps)
    return X / norms


def cosine_similarity_matrix(X: np.ndarray) -> np.ndarray:
    Xn = l2_normalize_rows(X)
    return Xn @ Xn.T


def dot_similarity_matrix(X: np.ndarray) -> np.ndarray:
    return X @ X.T


def stable_pair_hash(u: str, v: str, seed: int) -> float:
    """Deterministic hash in [0, 1) based on pair (u,v) and seed.

    Useful for generating placeholder metrics that are stable across runs
    for a given seed.
    """
    a, b = sorted([u, v])
    s = f"{seed}:{a}|{b}".encode()
    h = hashlib.sha256(s).digest()
    # take first 8 bytes as integer
    val = int.from_bytes(h[:8], "big")
    return (val % (10**12)) / float(10**12)


def select_topk_above_threshold(S: np.ndarray, tau: float, topk: int) -> Iterable[Tuple[int, int, float]]:
    """Yield (i, j, score) for i<j with score>=tau, keeping topk per row if topk>0.

    S is a symmetric similarity matrix with diagonal = 1.0 (or not used).
    """
    n = S.shape[0]
    for i in range(n):
        # Only consider j>i to avoid duplicates
        scores = S[i, i + 1 :]
        js = np.arange(i + 1, n)
        mask = scores >= tau
        scores = scores[mask]
        js = js[mask]
        if scores.size == 0:
            continue
        if topk > 0 and scores.size > topk:
            # Choose topk by score
            idx = np.argpartition(-scores, topk - 1)[:topk]
            sel_js = js[idx]
            sel_scores = scores[idx]
            # Sort for reproducibility
            order = np.argsort(-sel_scores)
            sel_js = sel_js[order]
            sel_scores = sel_scores[order]
        else:
            order = np.argsort(-scores)
            sel_js = js[order]
            sel_scores = scores[order]
        for j, sc in zip(sel_js, sel_scores):
            yield (i, j, float(sc))
