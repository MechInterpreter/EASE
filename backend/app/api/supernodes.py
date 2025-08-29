"""
FastAPI endpoints for automated supernode reconstruction
"""

from fastapi import APIRouter, HTTPException, Depends, Body
from pydantic import BaseModel
from typing import Dict, List, Any, Optional
import json
import logging
from pathlib import Path

from ..services.supernode_reconstruction import SupernodeReconstructor, ReconstructionConfig

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/supernodes", tags=["supernodes"])

class ReconstructionRequest(BaseModel):
    """Request model for supernode reconstruction"""
    attribution_graph: Dict[str, Any]
    config: Optional[Dict[str, Any]] = None

class ReconstructionResponse(BaseModel):
    """Response model for supernode reconstruction"""
    supernodes: List[Dict[str, Any]]
    rewired_graph: Dict[str, Any]
    merge_log: List[Dict[str, Any]]
    stats: Dict[str, Any]

@router.post("/reconstruct", response_model=ReconstructionResponse)
async def reconstruct_supernodes(request: ReconstructionRequest):
    """
    Reconstruct supernodes from an attribution graph using automated pipeline
    """
    try:
        # Parse configuration (use dataclass defaults if not provided)
        config_dict = request.config or {}
        defaults = ReconstructionConfig()
        config = ReconstructionConfig(
            tau_sim=float(config_dict.get('tau_sim', defaults.tau_sim)),
            alpha=float(config_dict.get('alpha', defaults.alpha)),
            beta=float(config_dict.get('beta', defaults.beta)),
            intra_layer_only=bool(config_dict.get('intra_layer_only', defaults.intra_layer_only))
        )
        
        # Initialize reconstructor
        reconstructor = SupernodeReconstructor(config)
        
        # Run reconstruction
        result = reconstructor.reconstruct_supernodes(request.attribution_graph)
        
        return ReconstructionResponse(**result)
        
    except Exception as e:
        logger.error(f"Error in supernode reconstruction: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Reconstruction failed: {str(e)}")

@router.get("/charlotte-data")
async def get_charlotte_data():
    """
    Load and return the Charlotte Neuronpedia data for the Dallas prompt
    """
    try:
        data_path = Path(__file__).parent.parent.parent.parent / "data" / "charlotte_neuronpedia.json"
        
        if not data_path.exists():
            raise HTTPException(status_code=404, detail="Charlotte data file not found")
        
        with open(data_path, 'r') as f:
            data = json.load(f)
        
        return data
        
    except Exception as e:
        logger.error(f"Error loading Charlotte data: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to load data: {str(e)}")

@router.post("/reconstruct-charlotte")
async def reconstruct_charlotte_supernodes(config: Optional[Dict[str, Any]] = Body(default=None)):
    """
    Convenience endpoint to reconstruct supernodes directly from Charlotte data
    """
    try:
        # Load Charlotte data
        charlotte_data = await get_charlotte_data()
        
        # Build config: use Charlotte preset when none provided
        if config is None:
            config = {
                "tau_sim": 0.85,
                "alpha": 0.8,
                "beta": 0.5,
                "intra_layer_only": False,
            }
        # Create reconstruction request
        request = ReconstructionRequest(
            attribution_graph=charlotte_data,
            config=config,
        )
        
        # Run reconstruction
        return await reconstruct_supernodes(request)
        
    except Exception as e:
        logger.error(f"Error in Charlotte supernode reconstruction: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Charlotte reconstruction failed: {str(e)}")

@router.get("/config/defaults")
async def get_default_config():
    """
    Get default reconstruction configuration parameters
    """
    defaults = ReconstructionConfig()
    return {
        "tau_sim": defaults.tau_sim,
        "alpha": defaults.alpha,
        "beta": defaults.beta,
        "intra_layer_only": defaults.intra_layer_only,
        "description": {
            "tau_sim": "Minimum cosine similarity for candidate merges",
            "alpha": "Minimum mean correlation for fidelity gate", 
            "beta": "Maximum cross-entropy gap for fidelity gate",
            "intra_layer_only": "Only merge nodes within the same layer"
        }
    }

@router.get("/config/preset/charlotte")
async def get_charlotte_preset_config():
    """Preset tuned thresholds for the Charlotte dataset"""
    return {
        "tau_sim": 0.85,
        "alpha": 0.8,
        "beta": 0.5,
        "intra_layer_only": False,
        "description": "Charlotte tuned preset thresholds",
    }
