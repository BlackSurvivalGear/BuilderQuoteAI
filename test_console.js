const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  await page.goto('http://localhost:3000/');

  // click workspace btn
  await page.click('#nav-workspace-btn');
  // load sample
  await page.click('text=Load Sample Project Description');
  // click generate
  await page.click('#generate-quote-btn');
  // wait 6 seconds
  await page.waitForTimeout(6000);

  await browser.close();
})();
