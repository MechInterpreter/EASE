from pathlib import Path
import os
from typing import Optional


class Config:
    """Basic configuration for the EASE backend.

    - EASE_DATA_PATH can point to a Neuronpedia-style JSON graph
    - Defaults to data/charlotte_neuronpedia.json in repo root
    """

    def __init__(self) -> None:
        root = Path(__file__).resolve().parents[2]
        default = root / "data" / "charlotte_neuronpedia.json"
        self.data_path: Path = Path(os.getenv("EASE_DATA_PATH", str(default)))
        self.normalize_fingerprints_default: bool = True
        self.allowed_origins = [
            "http://localhost",
            "http://127.0.0.1",
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ]


config = Config()
