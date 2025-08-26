from __future__ import annotations

from typing import Dict, Iterable, List


class DSU:
    """Disjoint Set Union (Union-Find) with path compression and union by size."""

    def __init__(self, items: Iterable[str]):
        self.index_of: Dict[str, int] = {}
        self.items: List[str] = []
        for i, x in enumerate(items):
            self.index_of[x] = i
            self.items.append(x)
        n = len(self.items)
        self.parent: List[int] = list(range(n))
        self.size: List[int] = [1] * n

    def find(self, x: str | int) -> int:
        i = self._to_index(x)
        while self.parent[i] != i:
            self.parent[i] = self.parent[self.parent[i]]
            i = self.parent[i]
        return i

    def _to_index(self, x: str | int) -> int:
        if isinstance(x, int):
            return x
        return self.index_of[x]

    def union(self, a: str | int, b: str | int) -> bool:
        ra = self.find(a)
        rb = self.find(b)
        if ra == rb:
            return False
        if self.size[ra] < self.size[rb]:
            ra, rb = rb, ra
        self.parent[rb] = ra
        self.size[ra] += self.size[rb]
        return True

    def groups(self) -> Dict[int, List[int]]:
        res: Dict[int, List[int]] = {}
        for i in range(len(self.items)):
            r = self.find(i)
            res.setdefault(r, []).append(i)
        return res

    def snapshot(self) -> List[int]:
        # Return a copy of current parents (rooted form)
        return [self.find(i) for i in range(len(self.items))]

    def restore(self, parents: List[int]) -> None:
        # Restore DSU state from a parent list
        self.parent = parents[:]
        # Recompute sizes
        self.size = [1] * len(self.items)
        for i in range(len(self.items)):
            if self.parent[i] != i:
                self.size[self.parent[i]] += 1
