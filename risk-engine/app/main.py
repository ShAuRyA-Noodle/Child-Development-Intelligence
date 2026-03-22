"""
ECD Risk Engine — FastAPI Application
Main application with CORS, health check, and router registration.
"""

import logging
import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import scoring, alerts, interventions, equity, validation
from app.services.ml_engine import load_model

load_dotenv()

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=LOG_LEVEL, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(
    title="ECD Risk Scoring Engine",
    description=(
        "AI-powered risk scoring, alert generation, and intervention recommendation "
        "engine for the Early Childhood Development Intelligence Platform."
    ),
    version="1.0.0",
)

# CORS middleware — allow all origins for development, restrict in production
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(scoring.router)
app.include_router(alerts.router)
app.include_router(interventions.router)
app.include_router(equity.router)
app.include_router(validation.router)


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    from app.services.ml_engine import is_model_loaded

    return {
        "status": "healthy",
        "service": "ecd-risk-engine",
        "version": "1.0.0",
        "ml_model_loaded": is_model_loaded(),
    }


@app.on_event("startup")
async def startup_event():
    """Load ML model on startup if available."""
    model_path = os.getenv("MODEL_PATH", "models/xgb_risk_model.json")
    logger.info(f"Attempting to load ML model from: {model_path}")
    loaded = load_model(model_path)
    if loaded:
        logger.info("ML model loaded successfully. Hybrid scoring enabled.")
    else:
        logger.info("No ML model found. Using rule-based scoring only.")
