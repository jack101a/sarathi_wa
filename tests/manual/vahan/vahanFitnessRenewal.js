/**
 * Standalone Interactive Vahan Fitness Renewal Script
 * 
 * Run with:
 *   node tests/manual/vahan/vahanFitnessRenewal.js
 */

const readline = require('readline');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

// Load environment config if available
require('dotenv').config();
const CONFIG = require('../../../src/config/config');
const { solveSarathiCaptcha, init: initSolver } = require('../../../src/services/sarathiCaptchaSolver');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const askQuestion = (query) => new Promise((resolve) => rl.question(query, resolve));

async function run() {
  console.log('================================================================');
  console.log('🚗 Vahan Vehicle Fitness Renewal - Standalone Interactive Tool');
  console.log('================================================================\n');

  // 1. Gather Initial Vehicle Parameters
  const defaultRegNo = 'mh47x3425';
  const defaultChassis = '79708';
  const defaultRto = 'R.T.O.BORIVALI';

  let regNo = await askQuestion(`🪪 Enter Vehicle Registration Number (default: ${defaultRegNo}): `);
  if (!regNo.trim()) regNo = defaultRegNo;
  regNo = regNo.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

  let chassisNo = await askQuestion(`🔩 Enter Chassis Number - Last 5 digits (default: ${defaultChassis}): `);
  if (!chassisNo.trim()) chassisNo = defaultChassis;
  chassisNo = chassisNo.trim();

  let rtoName = await askQuestion(`🏢 Enter RTO name filter (default: ${defaultRto}): `);
  if (!rtoName.trim()) rtoName = defaultRto;
  rtoName = rtoName.trim().toUpperCase();

  console.log('\n🤖 Initializing Captcha solver model...');
  try {
    await initSolver();
    console.log('✅ Captcha solver model loaded successfully!');
  } catch (e) {
    console.log('⚠️ Could not load mixed ONNX captcha solver. Script will fall back to manual input for all captchas.', e.message);
  }

  console.log('\n🚀 Launching Browser in Headful Mode...');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: null
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  try {
    // 2. Navigation to Vahan Validation Homepage
    console.log('📡 Navigating to Vahan Service Portal...');
    await page.goto('https://vahan.parivahan.gov.in/vahanservice/vahan/ui/statevalidation/homepage.xhtml');

    // Close any initial disclaimer popups
    console.log('🧹 Clearing initial portal notifications...');
    await page.getByRole('button', { name: 'Close' }).click({ timeout: 5000 }).catch(() => {});
    await page.getByRole('button', { name: 'OK' }).click({ timeout: 2000 }).catch(() => {});

    // 3. Enter Registration Number
    console.log(`📝 Entering Registration Number: ${regNo}...`);
    // Ensure "Vehicle Registration No." tab is selected if present
    await page.getByRole('link', { name: 'Vehicle Registration No.' }).click({ timeout: 3000 }).catch(() => {});
    
    const regInput = page.getByRole('textbox', { name: 'Enter Registration Number' }).first();
    await regInput.waitFor({ state: 'visible', timeout: 10000 });
    await regInput.click();
    await regInput.fill(regNo);

    // Accept policy checkbox
    console.log('✅ Accepting Terms and Conditions checkbox...');
    await page.locator('.ui-chkbox-icon').first().click();
    await page.waitForTimeout(500);

    // Click Proceed
    console.log('📡 Submitting vehicle verification...');
    await page.getByRole('button', { name: 'Proceed' }).click();
    await page.waitForTimeout(2000);

    // 4. Handle state validation "Proceed" popup
    console.log('🛡️ Handling dynamic "Proceed" confirmation dialog...');
    const secondProceedCandidates = [
      '#j_idt670',
      '#j_idt656',
      'button:has-text("Proceed")',
      'a:has-text("Proceed")',
      '.ui-button:has-text("Proceed")'
    ];
    let secondProceedClicked = false;
    for (const sel of secondProceedCandidates) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 2000 })) {
          await el.click();
          console.log(`   ↳ Clicked Proceed via selector: "${sel}"`);
          secondProceedClicked = true;
          break;
        }
      } catch (e) {}
    }
    if (!secondProceedClicked) {
      console.log('⚠️ Could not click second proceed automatically. If a modal is open, click "Proceed" inside the browser.');
      await page.waitForTimeout(3000);
    }

    // 5. Select "Apply for Fitness Renewal" service
    console.log('📋 Selecting "Apply for Fitness Renewal/Re-verification" service...');
    await page.getByRole('link', { name: 'Apply for Fitness Renewal/Re-' }).first().waitFor({ state: 'visible', timeout: 15000 });
    await page.getByRole('link', { name: 'Apply for Fitness Renewal/Re-' }).first().click();
    await page.waitForTimeout(2000);

    // Accept terms on next page & proceed
    console.log('✅ Accepting service-specific declaration checkbox...');
    await page.locator('.ui-chkbox-icon').first().click();
    await page.getByRole('button', { name: 'Proceed' }).click();
    await page.waitForTimeout(2000);

    // 6. Verification and OTP Generation
    console.log(`🔩 Verifying Chassis Number (Last 5 digits): ${chassisNo}...`);
    const chassisInput = page.getByRole('textbox', { name: 'Chassis Number(Last 5' }).first();
    await chassisInput.waitFor({ state: 'visible', timeout: 10000 });
    await chassisInput.click();
    await chassisInput.fill(chassisNo);

    console.log('📡 Clicking "Verify Details"...');
    await page.getByRole('button', { name: 'Verify Details' }).click();
    await page.waitForTimeout(1500);

    console.log('📲 Triggering SMS OTP Generation...');
    await page.getByLabel('Generate OTP').click();
    await page.waitForTimeout(2000);

    // Dismiss OTP sent confirmation modal (usually an empty PrimeFaces button)
    try {
      await page.getByRole('button').filter({ hasText: /^$/ }).click({ timeout: 4000 });
    } catch (e) {
      await page.locator('button:has-text("OK"), button:has-text("Close")').first().click({ timeout: 2000 }).catch(() => {});
    }

    // Interactive Terminal OTP Capture
    console.log('\n-------------------------------------------------------------');
    const smsOtp = await askQuestion('💬 Please enter the 4 or 6-digit SMS OTP received on mobile: ');
    console.log('-------------------------------------------------------------\n');

    console.log(`📝 Submitting OTP: ${smsOtp.trim()}...`);
    await page.getByRole('textbox', { name: 'Enter OTP' }).fill(smsOtp.trim());
    await page.getByRole('button', { name: 'Submit' }).click();
    await page.waitForTimeout(3000);

    // Optional clicks on details tabs (if they load state parameters)
    await page.getByRole('button', { name: ' Owner Vehicle/Tax Details' }).click({ timeout: 2000 }).catch(() => {});
    await page.getByRole('button', { name: ' Insurance Details' }).click({ timeout: 2000 }).catch(() => {});

    // 7. RTO Selection
    console.log('div:has-text("Within State") option...');
    await page.locator('div').filter({ hasText: /^Within State$/ }).click().catch(() => {});
    await page.waitForTimeout(500);

    console.log('🏢 Selecting RTO name...');
    const rtoDropdown = page.getByRole('combobox', { name: 'RTO Name' });
    await rtoDropdown.waitFor({ state: 'visible', timeout: 10000 });
    await rtoDropdown.click();
    await page.waitForTimeout(500);

    // Fill filter RTO
    await page.getByRole('textbox', { name: 'Filter' }).fill(rtoName.toLowerCase());
    await page.waitForTimeout(1000);

    // Select filtered option
    console.log(`🖱️ Clicking matching option for: ${rtoName}`);
    await page.getByRole('option', { name: new RegExp(rtoName, 'i') }).click();
    await page.waitForTimeout(1000);

    // 8. Book Appointment
    console.log('📅 Clicking "Book Appointment"...');
    await page.getByRole('button', { name: 'Book Appointment' }).click();
    await page.waitForTimeout(3000);

    // 9. Handle Slot Booking Iframe
    console.log('📦 Accessing Slot Booking Iframe...');
    const iframeLoc = page.locator('#bookAppt');
    await iframeLoc.waitFor({ state: 'visible', timeout: 15000 });
    const iframe = iframeLoc.contentFrame();

    // Captcha solving routine inside iframe
    let solvedCaptcha = '';
    try {
      console.log('🤖 Scanning booking iframe for Verification Code (Captcha) image...');
      await page.waitForTimeout(1500);
      const images = await iframe.locator('img').all();
      let captchaImg = null;
      for (const img of images) {
        const src = await img.getAttribute('src').catch(() => '');
        if (src && (src.includes('captcha') || src.includes('dispplay') || src.includes('Captcha'))) {
          captchaImg = img;
          break;
        }
      }

      if (captchaImg) {
        console.log('📸 Taking screenshot of slot booking captcha image...');
        const buffer = await captchaImg.screenshot().catch(() => null);
        if (buffer) {
          solvedCaptcha = await solveSarathiCaptcha(buffer);
          if (solvedCaptcha) {
            console.log(`🤖 OCR Decoded Verification Code: "${solvedCaptcha}"`);
          }
        }
      }
    } catch (e) {
      console.log('⚠️ Captcha auto-detect failed:', e.message);
    }

    console.log('\n-------------------------------------------------------------');
    const userCaptcha = await askQuestion(`🔑 Enter the slot booking Verification Code (Captcha) [Auto: ${solvedCaptcha || 'Failed'}]: `);
    console.log('-------------------------------------------------------------\n');

    const finalCaptcha = userCaptcha.trim() || solvedCaptcha;
    if (!finalCaptcha) {
      throw new Error('Verification Code (Captcha) is required to proceed with slot booking.');
    }

    console.log(`📝 Filling Verification Code: ${finalCaptcha}...`);
    const codeInput = iframe.getByRole('textbox', { name: 'Enter Verification Code:*' }).first();
    await codeInput.click();
    await codeInput.fill(finalCaptcha);

    console.log('📡 Retrieving user details in booking iframe...');
    await iframe.getByRole('button', { name: 'Get User Details' }).click();
    await page.waitForTimeout(2000);

    // Check user checkbox & Proceed
    await iframe.locator('.ui-chkbox-icon').first().click().catch(() => {});
    await iframe.getByRole('button', { name: 'Procced' }).click();
    await page.waitForTimeout(2000);

    // 10. Calendar and Date Selection Option
    console.log('\n📅 Calendar page loaded.');
    console.log('👉 Option [A]: Press Enter to run automatic booking clicks (next month, 1st day).');
    console.log('👉 Option [B]: Type "manual" if you want to select date and slots yourself in the browser.');
    const userChoice = await askQuestion('Your choice (press Enter for Auto / type "manual"): ');

    if (userChoice.toLowerCase() === 'manual') {
      console.log('\n⚠️ MANUAL OVERRIDE ACTIVATED');
      console.log('👉 Go to the browser window and select the date, slot, and click "Book User Details".');
      console.log('👉 Confirm the booking (Yes -> OK) inside the portal.');
      await askQuestion('💬 Press Enter in this terminal ONLY AFTER slot booking is confirmed and successful: ');
    } else {
      console.log('⚡ Running Auto-booking clicks...');
      await iframe.locator('#book_dt_input').click();
      await page.waitForTimeout(1000);

      // Navigate to next month
      console.log('🖱️ Clicking Next month...');
      await iframe.getByTitle('Next').click({ timeout: 3000 }).catch(async () => {
        // Fallback dropdown selection
        await iframe.getByLabel('select month').selectOption('5').catch(() => {});
      });
      await page.waitForTimeout(1000);

      // Select day 1
      console.log('🖱️ Selecting the 1st day of the month...');
      await iframe.getByRole('link', { name: '1', exact: true }).first().click();
      await page.waitForTimeout(1000);

      console.log('📡 Clicks submitted. Showing slot details...');
      await iframe.getByRole('button', { name: 'Show Slot Details' }).click();
      await page.waitForTimeout(2000);

      // Select first slot checkbox
      console.log('🖱️ Selecting available slot checkbox...');
      // Try specific and generic selectors
      await iframe.locator('.ui-chkbox-box.ui-widget.ui-corner-all.ui-state-default.ui-state-hover > .ui-chkbox-icon').first().click().catch(async () => {
        await iframe.locator('.ui-chkbox-icon').first().click().catch(() => {});
      });
      await page.waitForTimeout(1000);

      console.log('💾 Clicking "Book User Details"...');
      await iframe.getByRole('button', { name: 'Book User Details' }).click();
      await page.waitForTimeout(2000);

      console.log('🖱️ Confirming slot booking dialog...');
      await iframe.getByRole('button', { name: 'Yes' }).click().catch(() => {});
      await page.waitForTimeout(1500);

      console.log('🖱️ Dismissing final booking success OK alert...');
      await iframe.getByRole('button', { name: 'OK', exact: true }).click().catch(() => {});
      await page.waitForTimeout(1000);
    }

    // 11. Payment Gateway Flow
    console.log('\n💳 Slot Booked! Closing slot frame & proceeding to payment...');
    await page.getByRole('button', { name: 'Close' }).click().catch(() => {});
    await page.waitForTimeout(1000);

    console.log('📡 Clicking main page Proceed...');
    await page.getByRole('button', { name: 'Proceed' }).click();
    await page.waitForTimeout(1500);

    console.log('💳 Clicking Confirm Payment...');
    await page.getByRole('button', { name: 'Confirm Payment' }).click();
    await page.waitForTimeout(3000);

    // Select Gateway & Check Terms
    console.log('🏦 Selecting SBIePay (Multi Banking) payment gateway...');
    await page.locator('label').first().click().catch(() => {});
    await page.getByRole('listbox').getByRole('option', { name: 'SBIePay (Multi Banking)' }).click().catch(() => {});
    
    console.log('✅ Checking payment agreement checkbox...');
    await page.locator('span').nth(4).click().catch(() => {});
    
    console.log('📡 Continuing to payment portal...');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.waitForTimeout(4000);

    // UPI QR Method
    console.log('💳 Clicking UPI payment method...');
    await page.getByRole('link', { name: 'hUPI UPI' }).click().catch(() => {});
    await page.waitForTimeout(1000);

    console.log('🔘 Checking UPI QR option...');
    await page.getByRole('radio', { name: 'UPI QR' }).check().catch(() => {});
    await page.waitForTimeout(1000);

    console.log('📡 Generating payment QR code...');
    await page.getByRole('button', { name: 'Pay Now' }).click();
    await page.waitForTimeout(4000);

    // 12. Dynamic Payment Redirect Waiter
    console.log('\n=============================================================');
    console.log('🎉 UPI QR Code is now generated on your browser screen!');
    console.log('👉 Please scan the QR code and pay using your mobile app.');
    console.log('⏳ The script will automatically detect when the payment succeeds.');
    console.log('=============================================================\n');

    try {
      console.log('⏳ Waiting dynamically for redirect to receipt page...');
      await page.waitForURL('**/formFeeRecieptPrintReport.xhtml*', { timeout: 300000 }); // Wait up to 5 minutes
      console.log('✅ Payment redirect detected successfully!');
    } catch (e) {
      console.log('⚠️ Redirection timed out or missed. If payment was successful and the page loaded, press Enter.');
      await askQuestion('💬 Press Enter once the print receipt screen has loaded in browser: ');
    }

    // 13. Receipt Processing & Screen Capture
    console.log('⏳ Page fully loading...');
    await page.waitForTimeout(4000);

    console.log('🧹 Clearing receipt dialog popups...');
    await page.getByRole('button', { name: 'Close' }).click().catch(() => {});
    await page.waitForTimeout(1000);

    const receiptDir = path.join(__dirname, 'receipts');
    if (!fs.existsSync(receiptDir)) {
      fs.mkdirSync(receiptDir, { recursive: true });
    }

    const screenshotPath = path.join(receiptDir, `Receipt_${regNo}_${Date.now()}.png`);
    console.log(`📸 Saving full-page print receipt screenshot to: ${screenshotPath}`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    console.log('\n🎉 SUCCESS! The vehicle fitness renewal workflow is completely finished!');
    console.log(`Receipt image is saved at: ${screenshotPath}`);

  } catch (err) {
    console.error('\n❌ An error occurred during the automation flow:', err.message || err);
  } finally {
    await askQuestion('\n💬 Flow paused for manual inspection. Press Enter when you are ready to close the browser and exit: ');
    await browser.close().catch(() => {});
    rl.close();
  }
}

run();
