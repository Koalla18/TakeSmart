const fs = require('fs');
let content = fs.readFileSync('frontend/src/components/Shell.tsx', 'utf8');

const replacementCol = `              {/* Apple iPhone models */}
              <div>
                <h3 className="mb-4 text-sm font-semibold uppercase tracking-widest text-gray-500">Популярные продукты</h3>
                <ul className="space-y-2.5">
                  {[
                    { label: 'iPhone 15 Pro', to: '/catalog/c/smartphones?q=iphone+15+pro' },
                    { label: 'iPhone 16 Pro', to: '/catalog/c/smartphones?q=iphone+16+pro' },
                    { label: 'iPhone 16', to: '/catalog/c/smartphones?q=iphone+16' },
                    { label: 'AirPods 4', to: '/catalog/c/headphones?q=airpods+4' },
                    { label: 'AirPods Pro 2', to: '/catalog/c/headphones?q=airpods+pro+2' },
                  ].map(item => (
                    <li key={item.label}>
                      <Link
                        to={item.to}
                        className="text-sm text-gray-400 transition-colors hover:text-white"
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>`;

content = content.replace(/\{\/\* Apple iPhone models \*\/\}.*?<\/ul>\s*<\/div>/s, replacementCol);

const appleText = `Apple, логотип Apple, iPhone, iPad, Mac, MacBook, AirPods, Apple Watch, iMac, Mac mini, Mac Studio, Mac Pro, MagSafe, AirTag, Apple TV, Apple Pencil, Lightning являются зарегистрированными товарными знаками компании Apple Inc. в США и/или других странах.`;

if (content.includes('товарными знаками компании Apple Inc')) {
  // Try to remove it from where it might be (for example, above legal block)
  content = content.replace(/<div[^>]*>[\s\n]*iPhone, Apple Watch, AirPods, MacBook, iPad, Mac mini.*?(?:товарными знаками).*?<\/div>/s, '');
  content = content.replace(/<div(?:(?!<div).)*товарными знаками(?:(?!<\/div>).)*<\/div>/s, '');
}

const legalBlock = `<div className="mt-8 text-center text-[10px] leading-relaxed text-gray-500/40">
              Apple, логотип Apple, iPhone, iPad, Mac, MacBook, AirPods, Apple Watch, iMac, Mac mini, Mac Studio, Mac Pro, MagSafe, AirTag, Apple TV, Apple Pencil, Lightning являются зарегистрированными товарными знаками компании Apple Inc. в США и/или других странах.
            </div>
          </Container>`;

content = content.replace(/<\/Container>/g, match => {
  // Only replace the LAST Container which is in footer
  return match;
});

// Since replace with global flag isn't what we want, let's replace "          </Container>\n        </div>\n\n      </footer>"
content = content.replace(/          <\/Container>\n        <\/div>\n\n      <\/footer>/s, 
  `            <div className="mt-8 text-center text-[10px] leading-relaxed text-gray-500/40 opacity-40">
              Apple, логотип Apple, iPhone, iPad, Mac, MacBook, AirPods, Apple Watch, iMac, Mac mini, Mac Studio, Mac Pro, MagSafe, AirTag, Apple TV, Apple Pencil, Lightning являются зарегистрированными товарными знаками компании Apple Inc. в США и/или других странах.
            </div>\n          </Container>\n        </div>\n\n      </footer>`);

fs.writeFileSync('frontend/src/components/Shell.tsx', content);
