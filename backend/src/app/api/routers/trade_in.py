from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response

from src.app.api.admin.endpoints import get_current_admin
from src.app.core.logger import get_logger
from src.app.database.unit_of_work import UnitOfWork
from src.app.schemas.trade_in_offer import TradeInOfferCreate, TradeInOfferOut, TradeInOfferUpdate

logger = get_logger(__name__)
router = APIRouter(prefix="/trade-in", tags=["Trade-in"])


@router.get("", response_model=list[TradeInOfferOut], summary="Активные цены trade-in")
async def list_trade_in_offers() -> list[TradeInOfferOut]:
    async with UnitOfWork() as uow:
        return list(await uow.trade_in_offers.get_active())


@router.get("/all", response_model=list[TradeInOfferOut], dependencies=[Depends(get_current_admin)])
async def list_all_trade_in_offers() -> list[TradeInOfferOut]:
    async with UnitOfWork() as uow:
        return list(await uow.trade_in_offers.get_all())


@router.post("", response_model=TradeInOfferOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(get_current_admin)])
async def create_trade_in_offer(body: TradeInOfferCreate) -> TradeInOfferOut:
    async with UnitOfWork() as uow:
        offer = await uow.trade_in_offers.create(**body.model_dump())
        await uow.commit()
    logger.info("trade_in_offer_created", offer_id=str(offer.id), name=offer.name)
    return offer


@router.patch("/{offer_id}", response_model=TradeInOfferOut, dependencies=[Depends(get_current_admin)])
async def update_trade_in_offer(offer_id: UUID, body: TradeInOfferUpdate) -> TradeInOfferOut:
    async with UnitOfWork() as uow:
        offer = await uow.trade_in_offers.get_by_id(offer_id)
        if not offer:
            raise HTTPException(status_code=404, detail=f"Позиция trade-in {offer_id} не найдена")
        data = body.model_dump(exclude_unset=True)
        min_price = data.get("min_price", offer.min_price)
        max_price = data.get("max_price", offer.max_price)
        if Decimal(min_price) > Decimal(max_price):
            raise HTTPException(status_code=422, detail="Минимальная цена не может быть больше максимальной")
        updated = await uow.trade_in_offers.update(offer_id, **data)
        await uow.commit()
    logger.info("trade_in_offer_updated", offer_id=str(offer_id))
    return updated


@router.delete("/{offer_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response, dependencies=[Depends(get_current_admin)])
async def delete_trade_in_offer(offer_id: UUID) -> None:
    async with UnitOfWork() as uow:
        if not await uow.trade_in_offers.delete(offer_id):
            raise HTTPException(status_code=404, detail=f"Позиция trade-in {offer_id} не найдена")
        await uow.commit()
    logger.info("trade_in_offer_deleted", offer_id=str(offer_id))
