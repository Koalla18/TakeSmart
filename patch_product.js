const fs = require('fs');
let content = fs.readFileSync('frontend/src/pages/ProductPage.tsx', 'utf8');

// 1. Add isWatchGroup, isTabletGroup based on product category
content = content.replace(
  `const isLaptopGroup = allCards.some(c => /\\d+\\s*(?:ГБ|GB|ТБ|TB)\\s+SSD/i.test(c.name))`,
  `const isLaptopGroup = allCards.some(c => /\\d+\\s*(?:ГБ|GB|ТБ|TB)\\s+SSD/i.test(c.name))
                  const isWatchGroup = apiProduct.category?.slug === 'watches'
                  const isTabletGroup = apiProduct.category?.slug === 'tablets'`
);

// 2. Change labels for connectivity and storage
content = content.replace(
  `Связь: <span className="font-semibold text-gray-900">{currentParsed.connectivity || '—'}</span>`,
  `{isWatchGroup ? 'Размер корпуса' : isTabletGroup ? 'Связь / ОЗУ' : 'Связь'}: <span className="font-semibold text-gray-900">{currentParsed.connectivity || '—'}</span>`
);

content = content.replace(
  `{isLaptopGroup ? 'Память SSD' : 'Память'}: <span className="font-semibold text-gray-900">{currentParsed.storage || '—'}</span>`,
  `{isLaptopGroup ? 'Память SSD' : isWatchGroup ? 'Ремешок' : 'Память'}: <span className="font-semibold text-gray-900">{currentParsed.storage || '—'}</span>`
);

// 3. Update parseAttrsFromProduct to extract watch dimensions
const origParse = `  // ── Regular (non-laptop) parsing ──`;
const newParse = `  // ── Watch parsing ──
  const watchMatch = name.match(/(\\d+\\s*(?:мм|mm))(.*?)(?:,|$)/i);
  if (watchMatch && watchMatch[2] && !name.toLowerCase().includes('ssd')) {
    const conn = watchMatch[1].trim();
    const stor = watchMatch[2].trim();
    return { storage: stor || null, connectivity: conn, color: color || null };
  }

  // ── Regular (non-laptop) parsing ──`;
content = content.replace(origParse, newParse);

fs.writeFileSync('frontend/src/pages/ProductPage.tsx', content);
