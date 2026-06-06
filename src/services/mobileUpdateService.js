const fs = require('fs');
const { chromium } = require('playwright');
const { solveSarathiCaptcha } = require('./sarathiCaptchaSolver');
const { getTempFilePath } = require('../core/tempFiles');
const {
  sanitizePortalMessage,
  isPortalFailureMessage,
} = require('../utils/mobileUpdateMessages');
const CONFIG = require('../config/config');
const AADHAAR_OTP_MAX_ATTEMPTS = 3;

async function solvePortalCaptcha(page) {
  const rules = [
    { src: "#capimg", tgt: "input[name*='captxt']" },
    { src: "#capimg", tgt: "#entCaptha" },
    { src: "#capimg1", tgt: "#entcaptxt1" },
    { src: "#capimg", tgt: "#entcaptxt" }
  ];

  for (const rule of rules) {
    const tgt = page.locator(rule.tgt).first();
    const src = page.locator(rule.src).first();
    if (await tgt.count() > 0) {
      try {
        await src.waitFor({ state: 'attached', timeout: 5000 });
        const imgBytes = await src.screenshot({ timeout: 5000 }).catch(() => null);
        if (!imgBytes) continue;
        const text = await solveSarathiCaptcha(imgBytes);
        if (text) {
          console.log('[MobileService] Solved CAPTCHA:', text);
          await tgt.focus();
          await tgt.fill('');
          await page.waitForTimeout(200);
          await tgt.pressSequentially(text, { delay: 150 });
          return true;
        }
      } catch (e) {
        console.log('[MobileService] Captcha rule failed:', rule.tgt, e.message);
      }
    }
  }
  return false;
}

/**
 * Stage 1: Initiates navigation, fills license details, and triggers Aadhaar OTP generation.
 */
async function startMobileUpdateFlow(licenseNo, dob) {
  console.log(`🚀 [MobileService] Starting stage 1 navigation for DL: ${licenseNo}`);
  const headless = CONFIG.PUPPETEER.HEADLESS === 'new' || CONFIG.PUPPETEER.HEADLESS === true;
  const browser = await chromium.launch({ headless });
  let context;

  try {
  context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
  });
  
  const page = await context.newPage();
  page.setDefaultTimeout(90000);
  page.setDefaultNavigationTimeout(90000);

  // Keep dialogs from blocking automation while preserving their text for
  // stage-specific validation and user-safe error reporting.
  page._mobilePortalDialogs = [];
  page.on('dialog', async dialog => {
    const message = sanitizePortalMessage(dialog.message());
    console.log(`[MobileService] Global Intercepted Dialog: ${message} (${dialog.type()})`);
    if (message) page._mobilePortalDialogs.push(message);
    try {
      await dialog.accept();
    } catch (e) {
      await dialog.dismiss().catch(() => {});
    }
  });

  // 1. Navigation & State Selection
  await page.goto('https://sarathi.parivahan.gov.in/sarathiservice/stateSelection.do');
  try { await page.getByLabel('Close').click({ timeout: 5000 }); } catch (e) {}
  
  await Promise.all([
    page.waitForNavigation(),
    page.locator('#stfNameId').selectOption('AP')
  ]);
  await page.waitForLoadState('domcontentloaded');

  try { 
    const closeBtn = page.locator('.close, button.close, .modal .btn-close, .modal button[data-dismiss="modal"]').first();
    if (await closeBtn.isVisible({timeout: 5000})) {
        await closeBtn.click();
    }
  } catch (e) {}

  // 2. Direct Navigation to Mobile Update Page under established AP Session
  console.log('[MobileService] Navigating directly to mobNumUpdpub.do under established AP session...');
  await page.goto('https://sarathi.parivahan.gov.in/sarathiservice/mobNumUpdpub.do');
  await page.waitForLoadState('domcontentloaded');
  
  await page.locator('#licTypeId').selectOption('DL');

  // 3. Fill DL Details
  await page.getByRole('textbox', { name: 'License Number' }).fill(licenseNo);
  await page.getByRole('textbox', { name: 'Enter Date of Birth in DD-MM-' }).fill(dob);
  
  // 4. Captcha Solver Loop
  let captchaPassed = false;
  let retries = 0;
  while (!captchaPassed && retries < 10) {
    retries++;
    await solvePortalCaptcha(page);
    await page.getByRole('button', { name: 'Submit' }).click();
    
    // Check if we advanced to Aadhaar selection screen
    try {
      await page.locator('#authenticateWithTypeA').waitFor({ state: 'visible', timeout: 5000 });
      captchaPassed = true;
    } catch (e) {
      console.log(`[MobileService] Captcha incorrect on attempt ${retries}. Refreshing captcha...`);
      // Click captcha refresh button to fetch a new image
      try {
        const refreshBtn = page.locator('#caprefresh, .refresh-img, [id*="refresh"], [class*="refresh"]').first();
        if (await refreshBtn.count() > 0) {
          await refreshBtn.click();
          await page.waitForTimeout(2000);
        }
      } catch (err) {
        console.log('[MobileService] Failed to click captcha refresh:', err.message);
      }
    }
  }

  if (!captchaPassed) {
    await browser.close();
    throw new Error('Failed to solve captcha after 10 attempts.');
  }

  // 5. Select Aadhaar Auth
  await page.locator('#authenticateWithTypeA').check();
  
  return { browser, context, page };
  } catch (error) {
    if (context) await context.close().catch(() => {});
    await browser.close().catch(() => {});
    throw error;
  }
}

async function generateAadhaarOtp(page, aadhaarNo) {
  console.log('[MobileService] Entering Aadhaar Number...');
  const aadhaarField = page.locator('#aadharNumber');
  await aadhaarField.waitFor({ state: 'visible', timeout: 30000 });
  await aadhaarField.focus();
  await aadhaarField.click();
  await aadhaarField.fill('');
  await page.waitForTimeout(500);
  
  // Type sequentially with human-like keypress delays (150ms)
  await aadhaarField.pressSequentially(aadhaarNo, { delay: 150 });
  await page.waitForTimeout(1000);

  // Natively dispatch all key events and blur out of the field (simulating tab out / losing focus)
  console.log('[MobileService] Simulating human focus changes and events...');
  await aadhaarField.evaluate(el => {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('keyup', { bubbles: true }));
    el.blur();
  });
  await page.waitForTimeout(1000);

  // Force enable the Generate OTP button by removing the disabled attribute
  console.log('[MobileService] Force-enabling Generate OTP button...');
  const genBtn = page.locator('#generateotp, button:has-text("Generate OTP"), input[value="Generate OTP"]').first();
  await genBtn.evaluate(el => el.disabled = false);
  await page.waitForTimeout(500);

  let latestFailureMessage = '';
  for (let attempt = 1; attempt <= AADHAAR_OTP_MAX_ATTEMPTS; attempt++) {
    page._mobilePortalDialogs = [];
    console.log(`[MobileService] Aadhaar OTP generation attempt ${attempt}/${AADHAAR_OTP_MAX_ATTEMPTS}...`);
    await genBtn.evaluate(el => {
      el.removeAttribute('disabled');
      el.disabled = false;
    });
    await genBtn.click({ force: true });
    await page.waitForTimeout(2500);

    const dialogMessages = Array.isArray(page._mobilePortalDialogs)
      ? page._mobilePortalDialogs.splice(0)
      : [];
    const failureMessage = dialogMessages.find(isPortalFailureMessage);
    latestFailureMessage = failureMessage || latestFailureMessage;
    const otpInputVisible = await page.locator('#otpNumber').isVisible().catch(() => false);

    if (otpInputVisible && !failureMessage) {
      console.log('[MobileService] Aadhaar OTP triggered successfully.');
      return { ok: true };
    }

    if (attempt < AADHAAR_OTP_MAX_ATTEMPTS) {
      await page.waitForTimeout(1000);
    }
  }

  const error = new Error('Aadhaar OTP could not be generated after three attempts.');
  error.code = 'MOBILE_PORTAL_MESSAGE';
  error.publicMessage = latestFailureMessage || 'Aadhaar OTP could not be sent because the service is currently unavailable.';
  throw error;
}

/**
 * Stage 3: Authenticates Aadhaar OTP and proceeds to the final update screen.
 */
async function authenticateAadhaar(page, aadhaarOtp) {
  console.log('[MobileService] Authenticating Aadhaar OTP...');
  await page.locator('#otpNumber').fill(aadhaarOtp);
  await page.locator('#checkMe').check();
  await page.getByRole('checkbox').nth(1).check();
  await page.getByRole('checkbox').nth(2).check();
  
  await page.getByRole('button', { name: 'Authenticate' }).click();
  await page.waitForTimeout(2000);
  
  // Proceed to the core data update page
  await page.getByRole('button', { name: 'Proceed' }).click();
  await page.waitForLoadState('domcontentloaded');
  console.log('[MobileService] Successfully authenticated and navigated to mobile update landing page.');
}

/**
 * Stage 4: Evaluates the multi-step bypass and priming script on the loaded page.
 */
async function executeBypassScript(page, newMobileNumber, mobileOtp) {
  console.log(`🚀 [MobileService] Executing bypass/priming requests for ${newMobileNumber}...`);
  
  // Evaluate the target IIFE bypass script and capture the redirect HTML
  const result = await page.evaluate(async ({ newMob, userOtp }) => {
    let outputLogs = [];
    const log = (msg) => {
      console.log(msg);
      outputLogs.push(msg);
    };
    
    log("🚀 STARTING MULTI-STEP UPDATE PROCESS (SINGLE NUMBER + BYPASS MODE)...");

    // Disable annoying alerts
    window.alert = function(msg) { 
        log("⚠️ [Suppressed Alert]: " + msg); 
    };

    // Override validation checks
    window.mobNumCount = function() { 
        log("🔓 [Bypass]: eKYC mobile validation forced to TRUE.");
        return true; 
    };

    if (typeof $ !== 'undefined') {
        $('#ekycMob').val('');  
        log("🔓 [Bypass]: Cleared #ekycMob value.");
    }

    const baseUrl = "https://sarathi.parivahan.gov.in/sarathiservice";
    const baseHeaders = {
        "accept-language": "en-US,en;q=0.9",
        "sec-ch-ua": "\"Chromium\";v=\"148\", \"Google Chrome\";v=\"148\", \"Not/A)Brand\";v=\"99\"",
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": "\"Windows\"",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin"
    };

    try {
        if (!newMob) {
          log("❌ ABORTED: Mobile Number required.");
          return { success: false, html: null, logs: outputLogs };
        }

        log(`✅ Target Mobile Number: ${newMob}`);

        if (!userOtp) {
          log("❌ ABORTED: OTP required to proceed.");
          return { success: false, html: null, logs: outputLogs };
        }

        log("📡 [3/5] Verifying OTP...");
        const verifyBody = new URLSearchParams({
            otpValFrmJsp: userOtp,
            OtpType: "mobileOtp",
            newMobNum: newMob,
            cnfMobNum: newMob,
            reason: "update" 
        });

        let verifyRes = await fetch(`${baseUrl}/checkFirstOtpFromJsp.do`, {
            method: "POST",
            headers: {
                ...baseHeaders,
                "accept": "application/json, text/javascript, */*; q=0.01",
                "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                "x-requested-with": "XMLHttpRequest"
            },
            body: verifyBody,
            credentials: "include"
        });

        let verifyText = await verifyRes.text();
        log(`   ↳ OTP Verification Response: ${verifyText}`);

        log(`📡 [4/5] Saving mobile data (${newMob}) to database...`);
        const saveBody = new URLSearchParams({
            mobEnteredOtpId1: "",
            emailEnteredOtp: "",
            enableRTO: "N",
            newMobNum: newMob,
            reason: "update",
            cnfMobNum: newMob
        });

        await fetch(`${baseUrl}/saveNewMobData.do`, {
            method: "POST",
            headers: {
                ...baseHeaders,
                "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                "content-type": "application/x-www-form-urlencoded",
                "upgrade-insecure-requests": "1",
                "sec-fetch-dest": "document",
                "sec-fetch-user": "?1"
            },
            body: saveBody,
            credentials: "include"
        });

        log("📡 [5/5] Fetching final confirmation page...");
        let finalRes = await fetch(`${baseUrl}/mobNumUpdSubmitredirect.do`, {
            method: "GET",
            headers: {
                ...baseHeaders,
                "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                "upgrade-insecure-requests": "1",
                "sec-fetch-dest": "document",
                "sec-fetch-user": "?1"
            },
            credentials: "include"
        });

        let finalHtml = await finalRes.text();
        return { success: true, html: finalHtml, logs: outputLogs };

    } catch (e) {
        log("🔥 Request Pipeline Failed: " + e.message);
        return { success: false, html: null, logs: outputLogs };
    }
  }, { newMob: newMobileNumber, userOtp: mobileOtp });

  console.log('[MobileService] Bypass logs:');
  result.logs.forEach(l => console.log('  ', l));
  
  if (result.html) {
    // 5. Navigate to result and take visual screenshot
    console.log('[MobileService] Rendering final confirmation page HTML...');
    await page.setContent(result.html, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    
    // Check actual text on page to determine success
    let isActualSuccess = false;
    try {
      const pageText = await page.locator('.panel-body, .panel, body').first().innerText();
      console.log(`[MobileService] Extracted page text for validation: "${pageText.replace(/\n/g, ' ')}"`);
      if (/mobile.*number.*updated|successfully updated|success/i.test(pageText)) {
        isActualSuccess = true;
      }
    } catch (e) {
      console.log('[MobileService] Text-based success check failed:', e.message);
    }
    
    const outputFilename = `MobUpdate_${newMobileNumber}_${Date.now()}.png`;
    const outputPath = getTempFilePath(outputFilename);
    
    console.log(`[MobileService] Capturing screenshot to ${outputPath}...`);
    await page.setViewportSize({ width: 900, height: 1200 });
    
    let screenshotTaken = false;
    for (let attempt = 1; attempt <= 3 && !screenshotTaken; attempt++) {
      try {
        console.log(`[MobileService] Screenshot attempt ${attempt}/3...`);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        const panelBody = page.locator('.panel-body').first();
        const panel = page.locator('.panel').first();

        if (await panelBody.isVisible().catch(() => false)) {
          await panelBody.screenshot({ path: outputPath });
        } else if (await panel.isVisible().catch(() => false)) {
          await panel.screenshot({ path: outputPath });
        } else {
          await page.screenshot({ path: outputPath, fullPage: true });
        }

        screenshotTaken = fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0;
      } catch (error) {
        console.error(`[MobileService] Screenshot attempt ${attempt}/3 failed:`, error.message);
      }

      if (!screenshotTaken && attempt < 3) {
        await page.waitForTimeout(750);
      }
    }

    if (!screenshotTaken && fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
    
    return {
      success: isActualSuccess,
      screenshotPath: screenshotTaken ? outputPath : null,
    };
  }

  return { success: false };
}

module.exports = {
  startMobileUpdateFlow,
  generateAadhaarOtp,
  authenticateAadhaar,
  executeBypassScript
};
