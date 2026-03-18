import re

path = 'frontend/src/pages/ProductPage.tsx'
with open(path, 'r', encoding='utf-8') as f:
    text = f.read()

getparsed_old = """                  const getParsed = (item: any) => {
                    const attrs = item.attributes || {};
                    if (Object.keys(attrs).length > 0 && (attrs.storage || attrs.connectivity || attrs.processor)) {
                      return { storage: attrs.storage || null, connectivity: attrs.connectivity || null, ram: attrs.processor || null, color: item.color || null }
                    }
                    return parseAttrsFromProduct(item.name, item.color)
                  }"""

getparsed_new = """                  const getParsed = (item: any) => {
                    const attrs = item.attributes || {};
                    if (Object.keys(attrs).length > 0 && (attrs.storage || attrs.connectivity || attrs.processor)) {
                      return { storage: attrs.storage || null, connectivity: attrs.connectivity || null, ram: attrs.processor || null, color: item.color || null }
                    }
                    const parsed = parseAttrsFromProduct(item.name, item.color)
                    const isWatch = item.category?.slug === 'watches' || item.category?.slug === 'smart-bands' || /watch/i.test(item.name || '')
                    if (isWatch && parsed.storage) {
                       // Try to split storage (which has 'strapType strapSize') into strapType (ram) and strapSize (storage)
                       // Usually size is at the very end like ' S', ' S/M', ' M/L', ' 42mm', ' One Size'
                       const match = parsed.storage.match(/(.*?)\s+(S|M|L|S\/M|M\/L|One Size|Единый|41\s*mm|45\s*mm|49\s*mm|41\s*мм|45\s*мм|49\s*мм)$/i);
                       if (match) {
                           parsed.ram = match[1].trim(); // becomes Тип ремешка
                           parsed.storage = match[2].trim(); // becomes Размер ремешка
                       } else {
                           parsed.ram = parsed.storage; // all in type
                           parsed.storage = null;
                       }
                    }
                    return parsed;
                  }"""

text = text.replace(getparsed_old, getparsed_new)

with open(path, 'w', encoding='utf-8') as f:
    f.write(text)

print("Patched getParsed!")
