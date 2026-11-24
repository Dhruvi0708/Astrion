from fastapi import APIRouter

from app.api.v1 import auth, explorer, health, investigations, sources, workspaces

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(workspaces.router)
api_router.include_router(sources.router)
api_router.include_router(investigations.router)
api_router.include_router(explorer.router)
