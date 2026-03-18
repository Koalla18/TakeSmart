import re

path = 'frontend/src/pages/ProductPage.tsx'
with open(path, 'r', encoding='utf-8') as f:
    text = f.read()

text = text.replace(
    "ОЗУ: <span className=",
    "{isWatchGroup ? 'Тип ремешка' : 'ОЗУ'}: <span className="
)

text = text.replace(
    "{isLaptopGroup ? 'Память SSD' : isWatchGroup ? 'Ремешок' : 'Память'}:",
    "{isLaptopGroup ? 'Память SSD' : isWatchGroup ? 'Размер ремешка' : 'Память'}:"
)

text = text.replace(
    "{isWatchGroup ? 'Размер корпуса / Связь' : 'Связь'}:",
    "{isWatchGroup ? 'Размер корпуса' : 'Связь'}:"
)

with open(path, 'w', encoding='utf-8') as f:
    f.write(text)

print("Labels patched!")
