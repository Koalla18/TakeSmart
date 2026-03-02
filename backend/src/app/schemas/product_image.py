from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel


class ProductImageOut(BaseModel):
    id: UUID
    product_id: UUID
    file_path: str
    url: str
    original_filename: str
    mime_type: str
    file_size: int
    sort_order: int
    is_main: bool
    variant_color: str | None = None

    model_config = {"from_attributes": True}


class ReorderRequest(BaseModel):
    ordered_ids: list[UUID]

