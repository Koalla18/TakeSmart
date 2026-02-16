# Makefile для удобного запуска тестов

.PHONY: test test-fast test-cov test-watch help

help:  ## Показать справку
	@echo "Доступные команды:"
	@echo "  make test        - Запустить все тесты"
	@echo "  make test-fast   - Запустить тесты без coverage"
	@echo "  make test-cov    - Запустить тесты с отчетом о покрытии"
	@echo "  make test-watch  - Запустить тесты в режиме наблюдения"

test:  ## Запустить все тесты
	docker exec takesmart-backend-1 pytest tests/ -v

test-fast:  ## Быстрый запуск тестов
	docker exec takesmart-backend-1 pytest tests/ -x --tb=short

test-cov:  ## Тесты с coverage отчетом
	docker exec takesmart-backend-1 pytest tests/ --cov=app --cov-report=html --cov-report=term

test-auth:  ## Тесты авторизации
	docker exec takesmart-backend-1 pytest tests/test_auth.py -v

test-products:  ## Тесты продуктов
	docker exec takesmart-backend-1 pytest tests/test_products.py -v

test-orders:  ## Тесты заказов
	docker exec takesmart-backend-1 pytest tests/test_orders.py -v

test-categories:  ## Тесты категорий
	docker exec takesmart-backend-1 pytest tests/test_categories.py -v

