import re

path = 'frontend/src/pages/ProductPage.tsx'
with open(path, 'r', encoding='utf-8') as f:
    text = f.read()

pattern = r'const parsed = parseAttrsFromProduct\(item\.name, item\.color\)\s*const isWatch = item\.category\?\.slug === \'watches\' \|\| item\.category\?\.slug === \'smart-bands\' \|\| \/watch\/i\.test\(item\.name \|\| \'\'\)\s*if \(isWatch && parsed\.storage\) \{\s*const match = parsed\.storage\.match\(\/\(\.\*\?\)\\s\+\(S\|M\|L\|S\\\/M\|M\\\/L\|One Size\|Единый\|41\\s\*mm\|45\\s\*mm\|49\\s\*mm\|41\\s\*мм\|45\\s\*мм\|49\\s\*мм\)\$\/i\);\s*if \(match\) \{\s*parsed\.ram = match\[1\]\.trim\(\);\s*parsed\.storage = match\[2\]\.trim\(\);\s*\} else \{\s*parsed\.ram = parsed\.storage;\s*parsed\.storage = null;\s*\}\s*\}'

replacement = r'''const parsed = parseAttrsFromProduct(item.name, item.color)
                    const isWatch = item.category?.slug === 'watches' || item.category?.slug === 'smart-bands' || /watch/i.test(item.name || '')
      import re

path = 'frontend/src/pagif
path tch &with open(path, 'r', encoding='utf-8') as       text = f.read()

pattern = r'const pars  
pattern = r'constwSt
replacement = r'''const parsed = parseAttrsFromProduct(item.name, item.color)
                    const isWatch = item.category?.slug === 'watches' || item.category?.slug === 'smart-bands' || /watch/i.test(item.name || '')
      import re

path = 'frontend/src/pagif
path tch &with open(path, 'r', encoding='utf-8') as       text = f.read()

pattern = r'const pars  
pattern = r'constwSt
replacement = r'''const parsed = parseAttrsFromProduct(item.name, item.color)
                    const isWatch = item.category?.slug === 'watches' || item.category?.slug === 'smart-bands' || /watch/i.test(item.name || '')
      import re

path                        const isWatch = item.category?.slug === 'watches' || ite/\      import re

path = 'frontend/src/pagif
path tch &with open(path, 'r', encoding='utf-8') as       text = f.read()

pattern = r'const pars  , 
path = 'front   path tch &with open(path,de
pattern = r'const pars  
pattern = r'constwSt
replacement = r'''const p sepattern = r'constwSt
relereplacement = r'''cpl                    const isWatch = item.category?.slug === 'watches' || ite r      import re

path = 'frontend/src/pagif
path tch &with open(path, 'r', encoding='utf-8') as       text = f.read()

pattern = r'const pars    
path = 'frontparpath tch &with o = wConn ||
pattern = r'const pars  
pattern = r'constwSt
replacement = r'''const p|| pattern = r'constwSt
re  replacement = r'''ced                    const isWatch = item.category?.slug === 'watches' || ite//      import re

path                        const isWatch = item.category?.slug === 'watches' || ite/\      import re

path = 'frontend/src/pa  
path         e.s
path = 'frontend/src/pagif
path tch &with open(path, 'r', encoding='utf-8') as       text = f.read(h opath tch &with open(path,ut
pattern = r'const pars  , 
path = 'front   path tch &with open(path,de
se:path = 'front   path tch oupattern = r'const pars  
pattern = r'constedpattern = r'constwSt
ret'replacement = r'''cparelereplacement = romProduct')+500])
