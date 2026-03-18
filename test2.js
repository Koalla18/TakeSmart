function parseAttrsFromProduct(name, color = null) {
  let ram = null
  let storage = null
  let connectivity = null

  // Phone generic
  const memMatch = name.match(/(\d+)(?:\/|\\|\s+)(\d+)\s*(?:ГБ|GB)?/i)
  if (memMatch && !name.toLowerCase().includes('ssd')) {
    ram = `${memMatch[1].replace(/\s/g, '')} ГБ`
    storage = `${memMatch[2].replace(/\s/g, '')} ГБ`
  }

  // Fallback for single numbers (WAIT did I write this in ProductPage? Let's check)
  return { storage, connectivity, ram, color }
}
console.log(require('fs').readFileSync('frontend/src/pages/ProductPage.tsx', 'utf8').match(/parseAttrsFromProduct[\s\S]*?return \{/)[0])
