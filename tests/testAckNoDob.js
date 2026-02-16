require('dotenv').config();

const puppeteer = require('puppeteer');
const CONFIG = require('../src/config/config');

async function test() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(`${CONFIG.URLS.HOME}stateSelection.do`, {
    waitUntil: 'networkidle2'
  });

  await page.select('select.form-control.input-sm', process.env.STATE_CODE);

  await page.waitForTimeout(2000);

  const url = `${CONFIG.URLS.ACK}?applNum=${process.env.TEST_APP_NO}&type=ack`;

  const res = await page.evaluate(async (u) => {
    const r = await fetch(u, { credentials: "include" });
    return {
      status: r.status,
      text: await r.text()
    };
  }, url);

  console.log("HTTP STATUS:", res.status);
  console.log("Contains divToPrint:", res.text.includes("divToPrint"));

  await browser.close();
}

test();