import sys
sys.path.append('backend')
from src.app.schemas.product import ProductCreate, ProductOut
print(ProductCreate.model_fields.keys())
print(ProductOut.model_fields.keys())
