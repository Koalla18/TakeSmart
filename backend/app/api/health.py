from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health", summary="Проверка здоровья")
async def health():
    return {"ok": True}

