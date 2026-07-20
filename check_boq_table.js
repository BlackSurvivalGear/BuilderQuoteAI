const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:3000/');

  const typeOfRender = await page.evaluate(() => typeof renderBOQTable);
  console.log('TYPE OF renderBOQTable:', typeOfRender);

  await browser.close();
})();
