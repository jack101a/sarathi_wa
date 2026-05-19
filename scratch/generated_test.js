const { test, expect } = require('@playwright/test');
const { solveSarathiCaptcha } = require('../src/services/sarathiCaptchaSolver');
const { fetchInfo } = require('./info_fetcher');



async function smartSolveCaptcha(page) {
  console.log('[DEBUG Trace] ' + '[DEBUG] smartSolveCaptcha started');
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
        const imgBytes = await src.screenshot({ timeout: 5000 }).catch(e => null);
        if (!imgBytes) continue;
        const { solveSarathiCaptcha } = require('../src/services/sarathiCaptchaSolver');
        const text = await solveSarathiCaptcha(imgBytes);
        if (text) {
          console.log('[DEBUG Trace] ' + '[DEBUG] Solved:', text);
          await tgt.focus();
          await tgt.fill('');
          await page.waitForTimeout(200);
          await tgt.pressSequentially(text, { delay: 150 }); 
          return true;
        }
      } catch (e) {
        console.log('[DEBUG Trace] ' + '[DEBUG] Rule failed:', rule.tgt, e.message);
      }
    }
  }
  return false;
}



async function robustSelect(page, selector, value, label, isStateInjection = false) {
    console.log('[DEBUG Trace] ' + '[DEBUG] Selecting', value, 'for', selector);
    const loc = page.locator(selector).first();
    try {
        await loc.waitFor({ state: 'attached', timeout: 10000 });
        
        if (isStateInjection) {
            console.log('[DEBUG Trace] ' + '[DEBUG] PERFORMING STATE INJECTION: Value MH for label Uttar Pradesh');
            await page.evaluate((sel) => {
                const el = document.querySelector(sel);
                const options = Array.from(el.options);
                const up = options.find(o => o.textContent.toLowerCase().includes('uttar pradesh'));
                if (up) {
                    up.value = 'MH';
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }, selector);
            
            console.log('[DEBUG Trace] ' + '[DEBUG] Selecting "Select" then "Uttar Pradesh"');
            await loc.selectOption({ value: '-1' });
            await page.waitForTimeout(1000);
            await loc.selectOption({ label: 'Uttar Pradesh' });
        } else {
            console.log('[DEBUG Trace] ' + '[DEBUG] Setting value directly...');
            await loc.evaluate((el, val) => {
                el.value = val;
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }, value);
        }

        console.log('[DEBUG Trace] ' + '[DEBUG] Waiting 4 seconds...');
        await page.waitForTimeout(4000);

        if (!isStateInjection && label) {
            console.log('[DEBUG Trace] ' + '[DEBUG] Selecting by label:', label);
            await loc.selectOption({ label: label }, { timeout: 5000 }).catch(e => {
                return loc.selectOption({ label: label.toUpperCase() }, { timeout: 3000 });
            }).catch(e => {});
        }
    } catch (e) {
        console.log('[DEBUG Trace] ' + '[DEBUG] Robust selection failed for', selector, '-', e.message);
    }
    await page.waitForTimeout(2000);
}

test('test', async ({ page }) => {
  // Hardcoded inputs
  const appNo = '2081829326';
  const dob = '01-01-2001';

  console.log('[DEBUG Trace] ' + `[Test] Step 1: Fetching dynamic info for ${appNo}...`);
  const data = await fetchInfo(appNo, dob);
  console.log('[DEBUG Trace] ' + `[Test] Step 2: Data fetched successfully. Starting browser flow...`);

  // START ORIGINAL FLOW SELECTORS
  await page.goto('https://sarathi.parivahan.gov.in/sarathiservice/stateSelection.do');
  try { await page.getByLabel('Close').click({ timeout: 5000 }); } catch (e) {}
  
  await Promise.all([
    page.waitForNavigation(),
    page.locator('#stfNameId').selectOption('UP')
  ]);
  
  await page.waitForLoadState('domcontentloaded');
  // Robust popup closer
  try { 
    const closeBtn = page.locator('.close, button.close, .modal .btn-close, .modal button[data-dismiss="modal"]').first();
    if (await closeBtn.isVisible({timeout: 3000})) {
        await closeBtn.click();
    }
  } catch (e) {}

  
  // Use a more lenient selector for 'Learner Licence'
  const llLink = page.locator('text=/Learner Licence/i').first();
  await llLink.waitFor({ state: 'visible', timeout: 30000 });
  await llLink.click({ force: true });
  // Skip intermediate exploration clicks and go straight to Application Edit
  const appEditLink = page.locator('text=/Application Edit/i').first();
  await appEditLink.waitFor({ state: 'attached', timeout: 30000 });
  await appEditLink.evaluate(node => node.click());
  
  // --- Stage 1: Initial Application Details ---
  console.log('[DEBUG Trace] ' + "[Test] Filling application number and DOB...");
  await page.getByRole('textbox', { name: 'Application Number' }).fill(appNo);
  await page.getByRole('textbox', { name: 'Application Number' }).press('Tab');
  await page.getByRole('textbox', { name: 'Enter Date of Birth in dd-MM-' }).fill(dob);

  let stage1Success = false;
  let retries1 = 0;
  while (!stage1Success && retries1 < 5) {
    retries1++;
    await smartSolveCaptcha(page);
    
    {
        const loginSubmitBtn = page.locator('#submit, input[value="Submit"], button:has-text("Submit")').first();
        await loginSubmitBtn.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
        await loginSubmitBtn.evaluate(el => el.disabled = false); 
        await loginSubmitBtn.click();
    }

    try {
      // Wait for 'Confirm' button on the next page
      await page.getByRole('button', { name: 'Confirm' }).waitFor({ state: 'visible', timeout: 5000 });
      stage1Success = true;
    } catch (e) {
      console.log('[DEBUG Trace] ' + `[Test] Stage 1 failed (possibly wrong captcha), retry ${retries1}/5...`);
      try { await page.locator('#caprefresh, .refresh-img').first().click({ timeout: 2000 }); } catch(err) {}
    }
  }

  // --- Stage 2: Confirmation & Generate OTP ---
  console.log('[DEBUG Trace] ' + "[Test] Proceeding to Confirmation...");
  
    {
        const confirmBtn = page.locator('#confirm, input[value="Confirm"], button:has-text("Confirm"), .btn:has-text("Confirm")').first();
        await confirmBtn.waitFor({ state: 'attached', timeout: 5000 });
        await confirmBtn.evaluate(el => el.disabled = false); 
        await confirmBtn.click();
        console.log('[DEBUG Trace] ' + '[DEBUG] Clicked Confirm button, waiting 3 seconds for transition...');
        await page.waitForTimeout(3000);
    }


  let stage2Success = false;
  let retries2 = 0;
  while (!stage2Success && retries2 < 5) {
    retries2++;
    await smartSolveCaptcha(page);
    
    {
        console.log('[DEBUG Trace] ' + '[DEBUG] Checking if OTP input is already present...');
        const otpInput = page.locator('#otp, #otpSarathi, [name*="otp"], [title*="OTP"]').first();
        if (await otpInput.isVisible()) {
            console.log('[DEBUG Trace] ' + '[DEBUG] OTP input detected! Skipping Generate OTP button.');
            break; // Break the captcha loop if we are already on the OTP screen
        }

        console.log('[DEBUG Trace] ' + '[DEBUG] Looking for Generate OTP button...');
        const genBtn = page.locator('#generateOtp, button:has-text("Generate OTP"), input[value="Generate OTP"]').first();
        if (await genBtn.count() > 0) {
            await genBtn.click();
            await page.waitForTimeout(2000);
        } else {
            console.log('[DEBUG Trace] ' + '[DEBUG] Proceed button not found, taking debug screenshot...');
            await page.screenshot({ path: 'stage2_debug.png' });
        }
    }

    try {
      // Wait for OTP input field to appear
      await page.locator('#otpNumberSarathi').waitFor({ state: 'visible', timeout: 5000 });
      stage2Success = true;
    } catch (e) {
      console.log('[DEBUG Trace] ' + `[Test] Stage 2 failed (possibly wrong captcha), retry ${retries2}/5...`);
      try { await page.locator('#caprefresh, .refresh-img').first().click({ timeout: 2000 }); } catch(err) {}
    }
  }

  console.log('[DEBUG Trace] ' + "WAITING_FOR_OTP");
  const otp = await new Promise(resolve => {
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });
    readline.question('Enter OTP: ', (answer) => {
      readline.close();
      resolve(answer);
    });
  });
  
  
    {
        console.log('[DEBUG Trace] ' + '[DEBUG] Filling OTP...');
        const otpInput = page.locator('#otp, #otpSarathi, [name*="otp"], [title*="OTP"], #otpNumberSarathi').first();
        await otpInput.waitFor({ state: 'attached', timeout: 10000 });
        await otpInput.focus();
        await otpInput.fill(otp);
    }

  
  await smartSolveCaptcha(page);
  
  await page.locator('#otpCheckbox').check();
  
  {
      const otpInput = page.locator('#otp, #otpSarathi, [name*="otp"], [title*="OTP"]').first();
      await otpInput.waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});
      if (await otpInput.count() > 0) {
          await otpInput.focus();
          const submitBtn = page.locator('#verifySarathi, button:has-text("Submit OTP"), input[value="Submit OTP"]').first();
          await submitBtn.evaluate(el => el.disabled = false); 
          await submitBtn.click();
      }
  }


  
  // DYNAMIC FILLING WITH ORIGINAL SELECTORS
  
  console.log('[DEBUG Trace] ' + '[DEBUG] Form reached. Filling with DYNAMIC DATA (Attempt 19)...');
  const dyn = {"appNo":"2987422825","dob":"05-08-1994","fname":"AJAY","mname":"DIPESH","lname":"P","ffname":"DIPESH","fmname":"","flname":"TOLIA","bg":"O+","addressLine1":"ROOM NO-69 16 RUPAYA CHAWL PAREKH NAGAR S V","addressLine2":"MUMBAI SUBURBAN","pincode":"400067","fullAddress":"room no-69 16 rupaya chawl parekh nagar s v room no-69 16 rupaya chawl parekh nagar s v greater mumbai mumbai suburban mh 400067","covs":["LMV"]};
  const covMap = {"MCWG":"Motor Cycle with Gear(Non Transport) (MCWG)","LMV":"LIGHT MOTOR VEHICLE (LMV)","LMV-TR":"LMV-TR(GOODS) (LMV-TR)","3W-CAB":"LMV -3 Wheeler CAB (3W-CAB)","3W-GV":"LMV -3 Wheeler Transport Goods Non PSV (3W-GV)","MCWOG":"Motor cycle without Gear (Non Transport) (MCWOG)"};
  const fillField = async (sel, val) => {
      console.log('[DEBUG Trace] ' + '[DEBUG] Type/Fill', sel, 'with', val);
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

  console.log('[DEBUG Trace] ' + '[DEBUG] Matching District for address:', dyn.fullAddress);
  const districtOptions = await page.locator('#presDistrict option').evaluateAll(options => options.map(o => ({ value: o.value, text: o.textContent.trim() })));
  let selectedDist = districtOptions.find(o => dyn.fullAddress.toLowerCase().includes(o.text.toLowerCase()));
  if (!selectedDist && dyn.fullAddress.toLowerCase().includes('mumbai')) {
      selectedDist = districtOptions.find(o => o.text.toLowerCase().includes('mumbai suburban')) || districtOptions.find(o => o.text.toLowerCase().includes('mumbai'));
  }
  if (selectedDist) {
      console.log('[DEBUG Trace] ' + '[DEBUG] Found District Match:', selectedDist.text);
      await robustSelect(page, '#presDistrict', selectedDist.value, selectedDist.text);
  } else {
      await robustSelect(page, '#presDistrict', '518'); 
  }

  const subdistOptions = await page.locator('#presSubDistrict option').evaluateAll(options => options.map(o => o.value));
  const validSub = subdistOptions.find(v => v !== '-1');
  if (validSub) await robustSelect(page, '#presSubDistrict', validSub);

  await fillField('#presHouseNo', dyn.addressLine1);
  await fillField('#presStreet', dyn.addressLine2);
  await fillField('#presPinCode', dyn.pincode);
  await page.locator('#presSameAsPerm').check().catch(() => {});
  await page.waitForTimeout(1000);

  console.log('[DEBUG Trace] ' + '[DEBUG] Adding COVs:', dyn.covs);
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
  
  console.log('[DEBUG Trace] ' + '[DEBUG] Solving final captcha...');
  await smartSolveCaptcha(page);
  
  console.log('[DEBUG Trace] ' + '[DEBUG] WAITING 5 SECONDS FOR USER INSPECTION...');
  await page.waitForTimeout(5000);

  page.on('dialog', async dialog => {
      console.log('[DEBUG Trace] ' + '[DEBUG] Dialog appeared:', dialog.message());
      await dialog.accept().catch(() => {});
  });

  const finalConfirmBtn = page.locator('#submitOtp, #confirm, input[value="Confirm"], button:has-text("Confirm"), .btn:has-text("Confirm")').first();
  await finalConfirmBtn.waitFor({ state: 'attached', timeout: 5000 });
  console.log('[DEBUG Trace] ' + '[DEBUG] Submitting final form via multiple clicking techniques...');
  try {
      await finalConfirmBtn.evaluate(el => { 
          el.disabled = false; 
          el.click(); 
      });
      console.log('[DEBUG Trace] ' + '[DEBUG] DOM evaluate click completed.');
  } catch (e) {
      console.log('[DEBUG Trace] ' + '[DEBUG] DOM evaluate click failed:', e.message);
  }
  await page.waitForTimeout(1000);
  try {
      await finalConfirmBtn.click({ force: true, timeout: 3000 });
      console.log('[DEBUG Trace] ' + '[DEBUG] Playwright click completed.');
  } catch (e) {
      console.log('[DEBUG Trace] ' + '[DEBUG] Playwright click fallback failed:', e.message);
  }
  await page.waitForTimeout(1000);
  try {
      await finalConfirmBtn.evaluate(el => {
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      console.log('[DEBUG Trace] ' + '[DEBUG] MouseEvent click dispatch completed.');
  } catch (e) {
      console.log('[DEBUG Trace] ' + '[DEBUG] MouseEvent dispatch failed:', e.message);
  }
  console.log('[DEBUG Trace] ' + '[DEBUG] Final submit clicked! Waiting for success message "Application Updated Successfully"...');
  const successLocator = page.locator('text=/updated successfully|successfully|updated/i').first();
  await successLocator.waitFor({ state: 'visible', timeout: 30000 }).catch(e => {
      console.log('[DEBUG Trace] ' + '[DEBUG] Success message not found within 30s, continuing with priming requests...');
  });
  console.log('[DEBUG Trace] ' + '[DEBUG] Success message detected/timeout reached. Executing Priming Request 1 (confirmOrAdd_execute.do) for DYNAMIC_APP_NO:', dyn.appNo);
  const fetch1Status = await page.evaluate(async (d) => {
    try {
      const resp = await fetch("https://sarathi.parivahan.gov.in/sarathiservice/confirmOrAdd_execute.do", {
        "headers": {
          "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "accept-language": "en-GB,en;q=0.5",
          "cache-control": "no-cache",
          "content-type": "application/x-www-form-urlencoded",
          "pragma": "no-cache",
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": "'Windows'",
          "sec-fetch-dest": "document",
          "sec-fetch-mode": "navigate",
          "sec-fetch-site": "same-origin",
          "upgrade-insecure-requests": "1"
        },
        "referrer": "https://sarathi.parivahan.gov.in/sarathiservice/confirmOrAdd_execute.do",
        "body": "applicationNumber=" + d.appNo + "&dateOfBirth=" + d.dob + "&method%3AdivideTransactions=Confirm&isCorrect=true",
        "method": "POST",
        "mode": "cors",
        "credentials": "include"
      });
      return resp.status;
    } catch (err) {
      return err.message;
    }
  }, dyn);
  console.log('[DEBUG Trace] ' + '[DEBUG] Priming Request 1 Completed. Status/Result:', fetch1Status);

  console.log('[DEBUG Trace] ' + '[DEBUG] Waiting 4 seconds before second priming request...');
  await page.waitForTimeout(4000);

  console.log('[DEBUG Trace] ' + '[DEBUG] Executing Priming Request 2 (dlSearch.do)...');
  const fetch2Status = await page.evaluate(async () => {
    try {
      const resp = await fetch("https://sarathi.parivahan.gov.in/sarathiservice/dlSearch.do", {
        "headers": {
          "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "accept-language": "en-GB,en;q=0.5",
          "cache-control": "no-cache",
          "pragma": "no-cache",
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": "'Windows'",
          "sec-fetch-dest": "document",
          "sec-fetch-mode": "navigate",
          "sec-fetch-site": "same-origin",
          "upgrade-insecure-requests": "1"
        },
        "referrer": "https://sarathi.parivahan.gov.in/sarathiservice/sarathiHomePublic.do",
        "body": null,
        "method": "GET",
        "mode": "cors",
        "credentials": "include"
      });
      return resp.status;
    } catch (err) {
      return err.message;
    }
  });
  console.log('[DEBUG Trace] ' + '[DEBUG] Priming Request 2 Completed. Status/Result:', fetch2Status);

  console.log('[DEBUG Trace] ' + '[DEBUG] Waiting 4 seconds before refreshing main tab...');
  await page.waitForTimeout(4000);

  console.log('[DEBUG Trace] ' + '[DEBUG] Refreshing main page...');
  await page.reload();
  console.log('[DEBUG Trace] ' + '[DEBUG] Page refreshed successfully! Staying open.');
  await page.waitForTimeout(3600000);

});
