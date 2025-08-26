from app.dsu import DSU


def test_dsu_basic():
    d = DSU(["a", "b", "c"])    
    assert d.find("a") != d.find("b")
    assert d.union("a", "b") is True
    ra = d.find("a")
    rb = d.find("b")
    assert ra == rb
    assert d.size[ra] == 2
    assert d.union("b", "c") is True
    r = d.find("a")
    assert d.size[r] == 3
