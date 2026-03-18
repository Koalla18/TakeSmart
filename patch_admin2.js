const fs = require('fs')
const path = 'frontend/src/pages/AdminPage.tsx'
let text = fs.readFileSync(path, 'utf-8')

text = text.replace(
  "warranty_months: warranty ? parseInt(warranty) || null : null,",
  "warranty_months: warranty ? parseInt(warranty) || null : null,\n          attributes: { storage: item.storage || null, connectivity: item.connectivity || null, processor: item.processor || null },"
)

fs.writeFileSync(path, text)
