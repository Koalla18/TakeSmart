# Эта папка используется для хранения загруженных медиафайлов.
#
# Структура:
#   static/products/<product_uuid>/     — фото товаров
#   static/categories/<category_uuid>/  — иконки категорий
#   static/slides/<slide_uuid>/         — баннеры слайдера
#   static/misc/                        — прочие файлы
#
# В Docker монтируется как volume: static:/app/static
# В dev-режиме монтируется напрямую: ./backend/static:/app/static

