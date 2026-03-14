const fs = require('fs');
let content = fs.readFileSync('frontend/src/pages/AdminPage.tsx', 'utf8');

// The original lines in buildMatrix
const orig = `            } else {
              const parts = [baseName, proc, s, cn].filter(Boolean)
              fullName = c ? \`\${parts.join(' ')}, \${c}\` : parts.join(' ')
            }`;

const repl = `            } else if (catSlug === 'tablets') {
              const spec = [cn, s].filter(Boolean).map(v => v.replace(/(?:\\s*ГБ|\\s*ТБ)$/i, '')).join('/')
              const unit = s ? (s.toLowerCase().includes('тб') ? ' ТБ' : ' ГБ') : ''
              const memStr = spec ? \`\${spec}\${unit}\` : ''
              const parts = [baseName, memStr, proc].filter(Boolean)
              fullName = c ? \`\${parts.join(' ')}, \${c}\` : parts.join(' ')
            } else if (catSlug === 'watches') {
              // proc = Тип ремешка, s = Размер ремешка, cn = Размер циферблата. Expected order: Размер циф, Тип ремешка, Размер ремешка.
              const parts = [baseName, cn, proc, s].filter(Boolean)
              fullName = c ? \`\${parts.join(' ')}, \${c}\` : parts.join(' ')
            } else {
              const parts = [baseName, proc, s, cn].filter(Boolean)
              fullName = c ? \`\${parts.join(' ')}, \${c}\` : parts.join(' ')
            }`;

content = content.replace(orig, repl);
fs.writeFileSync('frontend/src/pages/AdminPage.tsx', content);