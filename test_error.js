const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  await page.goto('http://localhost:3000/');

  await page.click('#nav-workspace-btn');
  await page.click('text=Load Sample Project Description');
  await page.click('#generate-quote-btn');

  console.log('Waiting for pipeline to run...');
  await page.waitForTimeout(6000);

  const devLogs = await page.evaluate(() => {
    return BQAIPipeline.state.developerLogs;
  });
  console.log('DEVELOPER LOGS:', JSON.stringify(devLogs, null, 2));

  await browser.close();
})();
