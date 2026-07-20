const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err));
  await page.goto('http://localhost:3000/');

  await page.click('#nav-workspace-btn');
  await page.click('text=Load Sample Project Description');
  await page.click('#generate-quote-btn');

  console.log('Waiting for pipeline to run...');
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(1000);
    const progress = await page.textContent('#pipeline-progress-msg');
    console.log(`Progress at ${i}s:`, progress);
    const content = await page.textContent('#output-content-wrapper');
    if (content.includes('1. Executive Summary')) {
      console.log('Found Executive Summary!');
      break;
    }
  }

  await browser.close();
})();
