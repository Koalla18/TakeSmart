"""
Middleware module for request logging, rate limiting, and request ID tracking.
"""
import time
import uuid
import logging
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Callable
from fastapi import Request, Response, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware

from .settings import settings


# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger("takesmart")


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Log all incoming requests with timing information."""
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Generate unique request ID
        request_id = str(uuid.uuid4())[:8]
        request.state.request_id = request_id
        
        # Start timing
        start_time = time.time()
        
        # Get client IP
        client_ip = request.client.host if request.client else "unknown"
        
        # Log request
        logger.info(
            f"[{request_id}] {request.method} {request.url.path} - "
            f"Client: {client_ip}"
        )
        
        # Process request
        try:
            response = await call_next(request)
            
            # Calculate duration
            duration = round((time.time() - start_time) * 1000, 2)
            
            # Log response
            logger.info(
                f"[{request_id}] {request.method} {request.url.path} - "
                f"Status: {response.status_code} - "
                f"Duration: {duration}ms"
            )
            
            # Add request ID to response headers
            response.headers["X-Request-ID"] = request_id
            response.headers["X-Response-Time"] = f"{duration}ms"
            
            return response
            
        except Exception as e:
            duration = round((time.time() - start_time) * 1000, 2)
            logger.error(
                f"[{request_id}] {request.method} {request.url.path} - "
                f"Error: {str(e)} - "
                f"Duration: {duration}ms"
            )
            raise


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Simple in-memory rate limiting middleware."""
    
    def __init__(self, app):
        super().__init__(app)
        # Store: {ip: {path_group: [(timestamp, ...)]}}
        self.requests: dict = defaultdict(lambda: defaultdict(list))
        self.cleanup_interval = 60  # seconds
        self.last_cleanup = time.time()
    
    def _get_rate_limit(self, path: str) -> tuple[int, int]:
        """Get rate limit (requests, window_seconds) for path."""
        if "/api/auth" in path:
            return (settings.rate_limit_auth, 60)
        elif "/api/orders" in path:
            return (settings.rate_limit_orders, 60)
        else:
            return (120, 60)  # Default: 120 requests per minute
    
    def _cleanup_old_requests(self):
        """Remove old request records."""
        current_time = time.time()
        if current_time - self.last_cleanup < self.cleanup_interval:
            return
        
        cutoff = current_time - 120  # Keep last 2 minutes
        for ip in list(self.requests.keys()):
            for path_group in list(self.requests[ip].keys()):
                self.requests[ip][path_group] = [
                    ts for ts in self.requests[ip][path_group]
                    if ts > cutoff
                ]
                if not self.requests[ip][path_group]:
                    del self.requests[ip][path_group]
            if not self.requests[ip]:
                del self.requests[ip]
        
        self.last_cleanup = current_time
    
    def _get_path_group(self, path: str) -> str:
        """Group similar paths for rate limiting."""
        if "/api/auth" in path:
            return "auth"
        elif "/api/orders" in path:
            return "orders"
        elif "/api/admin" in path:
            return "admin"
        else:
            return "public"
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Skip rate limiting for health check
        if request.url.path == "/health":
            return await call_next(request)
        
        # Get client IP
        client_ip = request.client.host if request.client else "unknown"
        path = request.url.path
        path_group = self._get_path_group(path)
        
        # Get rate limit for this path
        max_requests, window_seconds = self._get_rate_limit(path)
        
        # Cleanup old requests periodically
        self._cleanup_old_requests()
        
        # Check rate limit
        current_time = time.time()
        window_start = current_time - window_seconds
        
        # Filter requests in current window
        recent_requests = [
            ts for ts in self.requests[client_ip][path_group]
            if ts > window_start
        ]
        self.requests[client_ip][path_group] = recent_requests
        
        if len(recent_requests) >= max_requests:
            logger.warning(
                f"Rate limit exceeded for {client_ip} on {path_group} "
                f"({len(recent_requests)}/{max_requests})"
            )
            raise HTTPException(
                status_code=429,
                detail={
                    "error": "Too many requests",
                    "retry_after_seconds": window_seconds,
                    "message": "Слишком много запросов. Попробуйте позже."
                }
            )
        
        # Record this request
        self.requests[client_ip][path_group].append(current_time)
        
        return await call_next(request)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to all responses."""
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        response = await call_next(request)
        
        # Security headers
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        
        # Remove server header for security
        if "server" in response.headers:
            del response.headers["server"]
        
        return response
