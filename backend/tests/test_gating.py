from app.pipeline import _apply_gates


def test_apply_gates_deterministic_pass_and_fail():
    # Compute gating with a known pair and seed, then set thresholds around it
    u, v, seed = "feature|0|0|0", "feature|0|1|0", 123
    r = _apply_gates(u, v, score=0.99, layer=0, seed=seed, alpha=0.0, beta=1.0)
    assert r is not None
    mean_corr, ce_gap = r
    # Tighten thresholds to fail
    r2 = _apply_gates(u, v, score=0.99, layer=0, seed=seed, alpha=mean_corr + 1e-6, beta=ce_gap - 1e-6 if ce_gap > 0 else 0.0)
    assert r2 is None
