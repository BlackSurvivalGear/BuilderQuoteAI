const fs = require('fs');
const lines = fs.readFileSync('js/app.js', 'utf8').split('\n');
lines.forEach((line, index) => {
  if (line.includes('renderBOQTable')) {
    console.log(`${index + 1}: ${line}`);
  }
});
