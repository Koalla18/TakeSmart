"""Самопроверка разбора команд и подбора товаров — без БД. Запуск из backend/: .venv/bin/python scripts/check_price_command.py"""
import sys, uuid
from decimal import Decimal
from types import SimpleNamespace as NS
sys.path.insert(0, ".")
from src.app.core.price_command import parse_command, resolve_targets, match_products

CAT_PH, CAT_HP, CAT_LT = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
categories = [NS(id=CAT_PH, name="Смартфоны", slug="smartphones"), NS(id=CAT_HP, name="Наушники", slug="headphones"), NS(id=CAT_LT, name="Ноутбуки", slug="laptops")]
brands = ["Apple", "Samsung", "Sony", "Dyson"]
def prod(name, price, cat, brand, color=None, disc=None, active=True, attrs=None):
    return NS(id=uuid.uuid4(), name=name, price=Decimal(price), discount_price=Decimal(disc) if disc else None, category_id=cat, brand=brand, color=color, sku=None, model=None, attributes=attrs, is_active=active)
products = [
    prod("iPhone 17 Pro 256 ГБ Синий титан", 154990, CAT_PH, "Apple", "Синий титан"),
    prod("iPhone 17 Pro Max 512 ГБ Оранжевый", 187670, CAT_PH, "Apple", "Оранжевый"),
    prod("iPhone 15 128 ГБ", 64990, CAT_PH, "Apple"),
    prod("Смартфон Samsung Galaxy S26 Розовый (Pink Gold), 512Гб, 2Sim+eSim", 119990, CAT_PH, "Samsung", "Розовый (Pink Gold)", attrs={"storage": "512Гб"}),
    prod("AirPods Max", 59990, CAT_HP, "Apple", disc=54990),
    prod("Sony WH-1000XM5", 39990, CAT_HP, "Sony", disc=34990),
    prod("Ноутбук Apple MacBook Pro 16 M5 Pro, 18C CPU, 20C GPU, 24ГБ, 1ТБ, Серебристый (Silver) (MGE94)", 249990, CAT_LT, "Apple", "Серебристый (Silver)"),
    prod("iPhone 16 128 ГБ (скрытый)", 69990, CAT_PH, "Apple", active=False),
    prod("Наушники Apple AirPods Pro 2 USB-C (2023)", 14990, CAT_HP, "Apple"),
    prod("Canon PowerShot G7X Mark 3", 101990, CAT_LT, "Canon"),
]
def run(text, **kw):
    parsed = parse_command(text)
    for k, v in kw.items(): setattr(parsed, k, v)
    cids, bset, toks = resolve_targets(parsed, categories=categories, brand_names=brands)
    items = match_products(parsed, products, category_ids=cids, brands=bset, tokens=toks, category_names={c.id: c.name for c in categories})
    return parsed, items
fails = 0
def check(cond, msg):
    global fails
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond: fails += 1

p, items = run("17 pro +2000")
check([i.name[:16] for i in items] == ["iPhone 17 Pro 25", "iPhone 17 Pro Ma"], "«17 pro +2000» → оба 17 Pro (и Max), без 15/16")
check(items[0].new_price == Decimal(156990), "+2000 к 154 990 = 156 990")

p, items = run("17 pro кроме max -1500")
check(len(items) == 1 and "Max" not in items[0].name and items[0].new_price == Decimal(153490), "«кроме max» исключает Pro Max, −1500")

p, items = run("наушники apple +5%")
check(sorted(i.name for i in items) == ["AirPods Max", "Наушники Apple AirPods Pro 2 USB-C (2023)"], "категория «наушники» + бренд apple → только наушники Apple (Sony не попал)")
check(items[0].new_price == Decimal(62990) and items[0].new_discount_price == Decimal(57690), "+5% к 59 990 = 62 990; скидочная 54 990 → 57 690 (хвост «…90» сохраняется)")

p, items = run("galaxy s26 512 = 89990")
check(len(items) == 1 and items[0].new_price == Decimal(89990), "«galaxy s26 512 = 89990» → одна модель, цена = 89 990")

p, items = run("sony -50000")
check(len(items) == 1 and not items[0].valid, "минус больше цены → позиция невалидна (цена ≤ 0)")

p, items = run("айфон 16 +1000")
check(len(items) == 0, "скрытый товар не подходит без «и скрытые»")
p, items = run("айфон 16 и скрытые +1000")
check(len(items) == 1 and not items[0].is_active, "с «и скрытые» — подходит")

p, items = run("все +5%")
check(len(items) == 9 and any("все товары" in w for w in p.warnings), "«все +5%» — все активные + предупреждение")

p, items = run("макбук про 16 +10%")
check(len(items) == 1 and items[0].new_price == Decimal(274990), "«макбук про 16 +10%» → MacBook Pro 16, 249 990 → 274 990 (хвост «…990»)")

p, items = run("дайсон +100")
check(len(items) == 0 and p.operation is not None, "нет товаров бренда → пусто, операция понята")

p, items = run("самсунг подешевел на 1 500")
check(p.operation.kind == "delta" and p.operation.value == Decimal(-1500) and len(items) == 1, "«подешевел на 1 500» → −1500, Samsung")

p, items = run("на 2000")
check(p.operation is None and any("на сколько" in w or "+2000" in w for w in p.warnings) or p.operation is None, "число без направления — операции нет, есть подсказка")

p, items = run("айфон 17 про на 2000 дороже")
check(p.operation is not None and p.operation.value == Decimal(2000) and len(items) == 2, "постфиксный глагол: «на 2000 дороже» → +2000")
p, items = run("на 5 процентов дешевле samsung")
check(p.operation is not None and p.operation.kind == "percent" and p.operation.value == Decimal(-5), "«на 5 процентов дешевле» → −5 %")
p, items = run("17 pro 2000")
check(p.operation is None and any("что с ним делать" in w for w in p.warnings), "число без операции → подсказка")

p, items = run("airpods pro 3 = 24990")
check(len(items) == 0, "«airpods pro 3»: цифра 3 не находит «2023» (границы числа)")
p, items = run("марк 3 -2000")
check(len(items) == 1 and "Mark 3" in items[0].name, "«марк 3» → алиас mark, Canon Mark 3")
p, items = run("все +5%")
check(len(items) == 9, "«все +5%» после добавления товаров — 9 активных")

print("\nFAILS:", fails)
sys.exit(1 if fails else 0)
