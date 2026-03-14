const fs = require('fs');
let code = fs.readFileSync('src/components/Shell.tsx', 'utf8');

code = code.replace(/navigate\(\`\/catalog\/c\/\$\{cat\.slug\}\`\)/g, 'navigate(`/catalog?category=${cat.slug}`)');
code = code.replace(/navigate\(\`\/catalog\/c\/\$\{cat\.slug\}\?brand=\$\{brand\.toLowerCase\(\)\}\`\)/g, 'navigate(`/catalog?category=${cat.slug}&brand=${brand.toLowerCase()}`)');
code = code.replace(/\/catalog\/c\/smartphones\?q=iphone\+15\+pro/g, '/catalog?category=smartphones&q=iPhone+15+Pro');
code = code.replace(/\/catalog\/c\/smartphones\?q=iphone\+16\+pro/g, '/catalog?category=smartphones&q=iPhone+16+Pro');
code = code.replace(/\/catalog\/c\/smartphones\?q=iphone\+16/g, '/catalog?category=smartphones&q=iPhone+16');
code = code.replace(/\/catalog\/c\/headphones\?q=airpods\+4/g, '/catalog?category=headphones&q=AirPods+4');
code = code.replace(/\/catalog\/c\/headphones\?q=airpods\+pro\+2/g, '/catalog?category=headphones&q=AirPods+Pro+2');

fs.writeFileSync('src/components/Shell.tsx', code);
