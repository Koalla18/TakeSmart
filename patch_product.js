const fs = require('fs')
const path = 'frontend/src/pages/ProductPage.tsx'
let text = fs.readFileSync(path, 'utf-8')

text = text.replace(
  "images?: ProductImage[]\n  description: string | null",
  "images?: ProductImage[]\n  attributes?: Record<string, string>\n  description: string | null"
)
text = text.replace(
  "main_image_url: string | null\n}",
  "main_image_url: string | null\n  attributes?: Record<string, string>\n}"
)
fs.writeFileSync(path, text)
