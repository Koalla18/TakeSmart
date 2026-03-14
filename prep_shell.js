const fs = require('fs');
let content = fs.readFileSync('frontend/src/components/Shell.tsx', 'utf8');

// replace MobileMenu to also fetch brands
const fetchReplacement = `
  const [categories, setCategories] = useState<any[]>([])
  const [brandsByCategory, setBrandsByCategory] = useState<Record<string, string[]>>({})
  const [expandedCatId, setExpandedCatId] = useState<string | null>(null)
  const [dataFetched, setDataFetched] = useState(false)
  const navigate = useNavigate();

  useEffect(() => {
    if (!isOpen || dataFetched) return;
    setDataFetched(true);
    
    Promise.all([
      fetch(\`\${API_BASE_URL}/api/categories?limit=100&only_active=true\`).then(r => r.json()),
      fetch(\`\${API_BASE_URL}/api/products?limit=2500&only_active=true\`).then(r => r.json())
    ])
    .then(([catData, prodData]) => {
      const cats = Array.isArray(catData) ? catData : (catData.items || [])
      setCategories(cats.filter((c: any) => !c.name.toLowerCase().includes('б/у')))
      
      const prods = Array.isArray(prodData) ? prodData : (prodData.items || [])
      const bMap: Record<string, Set<string>> = {}
      prods.forEach((p: any) => {
        if (!p.category_id || !p.brand) return
        if (!bMap[p.category_id]) bMap[p.category_id] = new Set()
        bMap[p.category_id].add(p.brand)
      })
      const finalMap: Record<string, string[]> = {}
      for (const [cid, set] of Object.entries(bMap)) {
        finalMap[cid] = Array.from(set).sort()
      }
      setBrandsByCategory(finalMap)
    })
    .catch(console.error)
  }, [isOpen, dataFetched])
`;

content = content.replace(`  const [categories, setCategories] = useState<any[]>([])

  useEffect(() => {
    fetch(\`\${API_BASE_URL}/api/categories?limit=100&only_active=true\`)
      .then(res => res.json())
      .then(data => {
        const items = Array.isArray(data) ? data : (data.items || [])
        setCategories(items.filter((c: any) => !c.name.toLowerCase().includes('б/у')))
      })
      .catch(console.error)
  }, [])`, fetchReplacement);

// Change rendering of categories
const menuRenderRegex = /\{categories\.map\(cat => \{[\s\S]*?\}\)\}/m;
const renderReplacement = `{categories.map(cat => {
                  let icon = '📦';
                  const name = cat.name.toLowerCase();
                  if (name.includes('смартфоны') || name.includes('телефон')) icon = '📱';
                  else if (name.includes('ноутбук')) icon = '💻';
                  else if (name.includes('наушник')) icon = '🎧';
                  else if (name.includes('час')) icon = '⌚';
                  else if (name.includes('планшет')) icon = '📱';
                  else if (name.includes('аксессуар')) icon = '🔌';

                  const brands = brandsByCategory[cat.id] || [];

                  return (
                    <div key={cat.id} className="flex flex-col">
                      <button
                        onClick={() => {
                          if (brands.length > 0) {
                            setExpandedCatId(expandedCatId === cat.id ? null : cat.id);
                          } else {
                            onClose();
                            navigate(\`/catalog/c/\${cat.slug}\`);
                          }
                        }}
                        className="flex items-center justify-between rounded-xl px-4 py-3 text-base font-medium text-gray-700 transition-colors hover:bg-gray-50"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-xl">{icon}</span>
                          <span>{cat.name}</span>
                        </div>
                        {brands.length > 0 && (
                          <ChevronRightIcon className={\`h-4 w-4 text-gray-400 transition-transform \${expandedCatId === cat.id ? 'rotate-90' : ''}\`} />
                        )}
                      </button>
                      
                      {expandedCatId === cat.id && brands.length > 0 && (
                        <div className="ml-12 mt-1 flex flex-col space-y-2 border-l border-gray-100 pl-4">
                          {brands.map(brand => (
                            <button
                              key={brand}
                              onClick={() => {
                                onClose();
                                navigate(\`/catalog/c/\${cat.slug}?brand=\${brand.toLowerCase()}\`);
                              }}
                              className="text-left py-1 text-sm text-gray-600 hover:text-gray-900"
                            >
                              {brand}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}`;
content = content.replace(menuRenderRegex, renderReplacement);

// Import useNavigate
if (!content.includes('useNavigate')) {
  content = content.replace(/import { Link, NavLink } from 'react-router-dom'/, "import { Link, NavLink, useNavigate } from 'react-router-dom'");
}

fs.writeFileSync('frontend/src/components/Shell.tsx', content);
