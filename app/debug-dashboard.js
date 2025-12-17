const fs = require('fs');

const file = 'src/app/dashboard/page.tsx';
let content = fs.readFileSync(file, 'utf8');

// Trouve la section où on charge les market accounts et ajoute des logs
const searchStr = `              const marketAcc = addr ? marketAccounts.get(addr) : null;
              const resolved = marketAcc?.resolved || false;
              const resolutionTime = marketAcc?.resolutionTime`;

const replaceStr = `              const marketAcc = addr ? marketAccounts.get(addr) : null;
              console.log('🔍 Market:', addr, 'Account:', marketAcc);
              const resolved = marketAcc?.resolved || false;
              const resolutionTime = marketAcc?.resolutionTime`;

content = content.replace(searchStr, replaceStr);

fs.writeFileSync(file, content);
console.log('✅ Debug logs added!');
