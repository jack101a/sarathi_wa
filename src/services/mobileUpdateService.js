const { chromium } = require('playwright');
const { solveSarathiCaptcha } = require('./sarathiCaptchaSolver');
const { getTempFilePath } = require('../core/tempFiles');
const CONFIG = require('../config/config');

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
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
  });
  
  const page = await context.newPage();
  page.setDefaultTimeout(90000);
  page.setDefaultNavigationTimeout(90000);

  // Register global dialogue handler immediately to prevent alert boxes blocking the thread
  page.on('dialog', async dialog => {
    console.log(`[MobileService] Global Intercepted Dialog: ${dialog.message()} (${dialog.type()})`);
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

  console.log('[MobileService] Clicking Generate OTP button natively via MouseEvent...');
  await genBtn.evaluate(el => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(1000);

  // Fallback click just in case
  await genBtn.click({ force: true }).catch(() => {});
  console.log('[MobileService] Aadhaar OTP triggered successfully.');
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
  
  // Handle native alerts dynamically
  page.once('dialog', dialog => {
    console.log(`[MobileService] Intercepted Alert dialog: ${dialog.message()}`);
    dialog.dismiss().catch(() => {});
  });
  
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
  
  // Inject variables by overriding window.prompt prior to IIFE execution
  await page.evaluate(({ mob, otp }) => {
    window.prompt = (msg) => {
      if (msg.includes("Mobile Number") || msg.includes("Number")) return mob;
      if (msg.includes("OTP")) return otp;
      return "";
    };
  }, { mob: newMobileNumber, otp: mobileOtp });

  // Evaluate the target IIFE bypass script and capture the redirect HTML
  const result = await page.evaluate(async () => {
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
        let newMob = prompt("📱 Enter the Mobile Number:");
        if (!newMob) {
          log("❌ ABORTED: Mobile Number required.");
          return { success: false, html: null, logs: outputLogs };
        }

        log(`✅ Target Mobile Number: ${newMob}`);

        log(`📡 [1/5] Checking Mobile Count for ${newMob}...`);
        await fetch(`${baseUrl}/checkMobCount.do`, {
            method: "POST",
            headers: {
                ...baseHeaders,
                "accept": "application/json, text/javascript, */*; q=0.01",
                "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                "x-requested-with": "XMLHttpRequest"
            },
            body: new URLSearchParams({ MobNum: newMob }),
            credentials: "include" 
        });

        log(`📡 [2/5] Requesting OTP sent to ${newMob}...`);
        let timestamp = Date.now();
        await fetch(`${baseUrl}/sendOTPInMobNumUpd.do?newMobNum=${newMob}&_=${timestamp}`, {
            method: "GET",
            headers: {
                ...baseHeaders,
                "accept": "*/*",
                "x-requested-with": "XMLHttpRequest"
            },
            credentials: "include"
        });

        let userOtp = prompt(`🔑 Enter OTP:`);
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
  });

  console.log('[MobileService] Bypass logs:');
  result.logs.forEach(l => console.log('  ', l));
  
  if (result.success && result.html) {
    // 5. Navigate to result and take visual screenshot
    console.log('[MobileService] Rendering final confirmation page HTML...');
    await page.setContent(result.html, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    
    const outputFilename = `MobUpdate_${newMobileNumber}_${Date.now()}.png`;
    const outputPath = getTempFilePath(outputFilename);
    
    console.log(`[MobileService] Capturing screenshot to ${outputPath}...`);
    await page.setViewportSize({ width: 900, height: 1200 });
    await page.screenshot({ path: outputPath, fullPage: true });
    
    return { success: true, screenshotPath: outputPath };
  }

  return { success: false };
}

module.exports = {
  startMobileUpdateFlow,
  generateAadhaarOtp,
  authenticateAadhaar,
  executeBypassScript
};
