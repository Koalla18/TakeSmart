const fs = require('fs');
let code = fs.readFileSync('frontend/src/pages/ProductPage.tsx', 'utf8');

const regex = /interface ParsedAttrs \{[\s\S]*?(?=\/\*\*)/m;
console.log("Current interface:", code.match(regex)[0]);
