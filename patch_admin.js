const fs = require('fs');
let content = fs.readFileSync('frontend/src/pages/AdminPage.tsx', 'utf8');

content = content.replace(
  `  tablets: [
    { field: 'color', label: 'Цвета', placeholder: 'Space Gray' },
    { field: 'storage', label: 'Память', placeholder: '256 ГБ' },
    { field: 'connectivity', label: 'Связь', placeholder: 'WiFi + Cellular' },
  ],`,
  `  tablets: [
    { field: 'color', label: 'Цвета', placeholder: 'Space Gray' },
    { field: 'connectivity', label: 'ОЗУ', placeholder: '8 ГБ', hint: 'Объём оперативной памяти' },
    { field: 'storage', label: 'Память', placeholder: '256 ГБ', hint: 'Объём встроенной памяти' },
    { field: 'processor', label: 'Связь', placeholder: 'WiFi + Cellular', hint: 'Тип связи (WiFi, 5G...)' },
  ],`
);

content = content.replace(
  `  watches: [
    { field: 'color', label: 'Цвета', placeholder: 'Титан' },
    { field: 'storage', label: 'Размер ремешка', placeholder: 'S/M' },
    { field: 'connectivity', label: 'Размер циферблата', placeholder: '42 мм' },
  ],`,
  `  watches: [
    { field: 'color', label: 'Цвета', placeholder: 'Титан' },
    { field: 'processor', label: 'Тип ремешка', placeholder: 'Sport Band' },
    { field: 'storage', label: 'Размер ремешка', placeholder: 'S/M' },
    { field: 'connectivity', label: 'Размер циферблата', placeholder: '42 мм' },
  ],`
);

fs.writeFileSync('frontend/src/pages/AdminPage.tsx', content);
