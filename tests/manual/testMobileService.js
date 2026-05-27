const readline = require('readline');
const {
  startMobileUpdateFlow,
  generateAadhaarOtp,
  authenticateAadhaar,
  executeBypassScript
} = require('../../src/services/mobileUpdateService');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const askQuestion = (query) => new Promise((resolve) => rl.question(query, resolve));

async function run() {
  console.log('🏁 Starting Mobile Number Update Test Ground Harness...\n');
  
  const defaultLicenseNo = 'mh47 20190023958';
  const defaultDob = '09-01-2001';
  
  let licenseNo = await askQuestion(`🪪 Enter License Number (default: ${defaultLicenseNo}): `);
  if (!licenseNo.trim()) licenseNo = defaultLicenseNo;
  
  let dob = await askQuestion(`📅 Enter Date of Birth in DD-MM-YYYY (default: ${defaultDob}): `);
  if (!dob.trim()) dob = defaultDob;
  
  let browser, context, page;
  
  try {
    // 1. Initial State Selection, Navigation & Captcha Solving
    const session = await startMobileUpdateFlow(licenseNo, dob);
    browser = session.browser;
    context = session.context;
    page = session.page;

    // 2. Input Aadhaar
    const aadhaarNo = await askQuestion('\n👤 Enter Aadhaar Number (12 digits): ');
    await generateAadhaarOtp(page, aadhaarNo);
    
    // 3. Input Aadhaar OTP
    const aadhaarOtp = await askQuestion('🔑 Enter 6-digit Aadhaar OTP sent to Aadhaar-registered mobile: ');
    await authenticateAadhaar(page, aadhaarOtp);

    // 4. Input Target Mobile to Update
    const newMobile = await askQuestion('\n📱 Enter the target Mobile Number to update/prime: ');
    
    // Expose OTP retriever from Node (CLI terminal) to Browser context
    await page.exposeFunction('getMobileOtpFromUser', async () => {
      const otp = await askQuestion('🔑 Enter the 6-digit OTP sent to new mobile: ');
      return otp;
    });

    console.log('[Harness] Submitting target mobile number and executing unified bypass IIFE...');
    
    const result = await page.evaluate(async (targetMob) => {
      let outputLogs = [];
      const log = (msg) => {
        console.log(msg);
        outputLogs.push(msg);
      };
      
      log("🚀 STARTING MULTI-STEP UPDATE PROCESS (SINGLE NUMBER + BYPASS MODE)...");

      // Disable annoying alerts and route them to console instead
      window.alert = function(msg) { 
          log("⚠️ [Suppressed Alert]: " + msg); 
      };

      // Monkey-patch the function(s) that check for eKYC mobile equality
      window.mobNumCount = function() { 
          log("🔓 [Bypass]: eKYC mobile validation forced to TRUE.");
          return true; 
      };

      // Pretend no Aadhaar mobile is set (Requires jQuery to be loaded on the page)
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
          log(`✅ Target Mobile Number: ${targetMob}`);

          log(`📡 [1/5] Checking Mobile Count for ${targetMob}...`);
          await fetch(`${baseUrl}/checkMobCount.do`, {
              method: "POST",
              headers: {
                  ...baseHeaders,
                  "accept": "application/json, text/javascript, */*; q=0.01",
                  "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                  "x-requested-with": "XMLHttpRequest"
              },
              body: new URLSearchParams({ MobNum: targetMob }),
              credentials: "include" 
          });

          log(`📡 [2/5] Requesting OTP sent to ${targetMob}...`);
          let timestamp = Date.now();
          await fetch(`${baseUrl}/sendOTPInMobNumUpd.do?newMobNum=${targetMob}&_=${timestamp}`, {
              method: "GET",
              headers: {
                  ...baseHeaders,
                  "accept": "*/*",
                  "x-requested-with": "XMLHttpRequest"
              },
              credentials: "include"
          });

          // Prompt user dynamically in CLI terminal via exposed function!
          log("📡 Waiting for OTP to be entered in the terminal...");
          let userOtp = await window.getMobileOtpFromUser();
          if (!userOtp) {
            log("❌ ABORTED: OTP required to proceed.");
            return { success: false, logs: outputLogs };
          }

          log(`✅ Received OTP: ${userOtp}. Proceeding with verification...`);

          log("📡 [3/5] Verifying OTP...");
          const verifyBody = new URLSearchParams({
              otpValFrmJsp: userOtp,
              OtpType: "mobileOtp",
              newMobNum: targetMob,
              cnfMobNum: targetMob,
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

          log(`📡 [4/5] Saving mobile data (${targetMob}) to database...`);
          const saveBody = new URLSearchParams({
              mobEnteredOtpId1: "",
              emailEnteredOtp: "",
              enableRTO: "N",
              newMobNum: targetMob,
              reason: "update",
              cnfMobNum: targetMob
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

          if (finalHtml.includes("Successfully") || finalHtml.includes("Success")) {
              log(`🎉 RESULT: SUCCESS! Database updated with ${targetMob}.`);
              return { success: true, logs: outputLogs };
          } else if (finalHtml.includes("Access denied")) {
              log("❌ RESULT: Access Denied. Session expired or OTP was incorrect.");
              return { success: false, logs: outputLogs };
          } else {
              log("⚠️ RESULT: Workflow finished. Check screen to confirm the update.");
              return { success: true, logs: outputLogs };
          }
      } catch (e) {
          log("🔥 Request Pipeline Failed: " + e.message);
          return { success: false, logs: outputLogs };
      }
    }, newMobile);

    console.log('[Harness] Bypass logs from browser execution:');
    result.logs.forEach(l => console.log('  ', l));

    if (result.success) {
      console.log('\n🎉 [Success] Mobile number successfully updated in the test ground!');
    } else {
      console.log('\n❌ [Failure] Bypass pipeline returned false. Please review console logs.');
    }
  } catch (error) {
    console.error('\n🔥 [Error] Test runner encountered a failure:', error.message || error);
  } finally {
    const action = await askQuestion('\nType anything to close the browser and exit: ');
    if (browser) await browser.close();
    rl.close();
  }
}

run();
