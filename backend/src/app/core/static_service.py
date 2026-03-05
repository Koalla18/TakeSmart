"""
Backward-compatible re-export.

All file storage now goes through S3 (see static_service_s3.py).
This module re-exports the singleton so existing imports keep working.
"""
from src.app.core.static_service_s3 import static_service, StaticFileService

__all__ = ["static_service", "StaticFileService"]
