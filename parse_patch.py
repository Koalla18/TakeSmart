import re

path = 'frontend/src/pages/ProductPage.tsx'
with open(path, 'r', encoding='utf-8') as f:
    text = f.read()

text = text.replace(
    "const isWatchGroup = apiProduct.category?.slug === 'watches'",
    "const isWatchGroup = apiProduct.category?.slug === 'watches' || apiProduct.category?.slug === 'smart-bands' || /watch/i.test(apiProduct.name || '')"
)

old_logic = """                  // Parse attributes from names (storage + connectivity)
                  const cardsWithAttrs = allCards.map(c => {
                    const parsed = parseAttrsFromProduct(c.name, c.color)
                    return { ...c, storage: parsed.storage, connectivity: parsed.connectivity, ram: parsed.ram }
                  })

                  const currentColor = apiProduct.color || null
                  const currentParsed = parseAttrsFromProduct(apiProduct.name, apiProduct.color)"""

new_logic = """                  // Parse attributes from names (or use JSON attributes if present)
                  const getParsed = (item: any) => {
                    const attrs = item.attributes || {};
                    if (Object.keys(attrs).length > 0 && (attrs.storage || attrs.connectivity || attrs.processor)) {
                      return { storage: attrs.storage || null, connectivity: attrs.connectivity || null, ram: attrs.processor || null, color: item.color || null }
                    }
                    return parseAttrsFromProduct(item.name, item.color)
                  }

                  const cardsWithAttrs = allCards.map(c => {
                    const parsed = getParsed(c)
                    return { ...c, storage: parsed.storage, connectivity: parsed.connectivity, ram: parsed.ram }
                  })

                  const currentColor = apiProduct.color || null
                  const currentParsed = getParsed(apiProduct)"""

text = text.replace(old_logic, new_logic)

# Replace the fallback memory labels for watch group.
text = text.replace(
  "{isWatchGroup ? 'Размер корпуса' : 'Связь'}",
  "{isWatchGroup ? 'Размер корпуса / Связь' : 'Связь'}"
)

with open(path, 'w', encoding='utf-8') as f:
    f.write(text)

print("Patched!")