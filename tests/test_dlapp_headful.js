const readline = require('readline');
const CONFIG = require('../src/config/config');

// Override headless configuration to show the browser window
CONFIG.PUPPETEER.HEADLESS = false;

const applyDlService = require('../src/services/applyDlService');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const llNo = "MH47 /0050138/2026";
const dob = "02-01-2000"; // Trigger with user-requested DOB: 02-01-2000
const mobile = "";      // Auto-resolved by system

async function run() {
    console.log(`================================================================`);
    console.log(`🚀 Starting dlapp (Apply DL) Interactive Test in Headful Mode`);
    console.log(`LL No: ${llNo}, DOB: ${dob}`);
    console.log(`================================================================\n`);
    
    let flow;
    try {
        // Step 1: Start DL flow (launches visible browser, solves captchas, generates OTP)
        flow = await applyDlService.startApplyDLFlow(llNo, dob, mobile);
        console.log(`\n✅ SMS OTP triggered successfully!`);
        
        // Step 2: Prompt user in terminal for OTP code to proceed
        rl.question('💬 Please enter the 6-digit SMS OTP received on your mobile: ', async (otpCode) => {
            rl.close();
            try {
                console.log(`\n⏳ Submitting OTP: ${otpCode} & completing vehicle choices, Form 1, and declarations...`);
                
                // Step 3: Complete flow (checks disclaimer boxes, solves captcha, and submits)
                const result = await applyDlService.submitApplyDLOTP(flow.browser, flow.context, flow.page, otpCode.trim());
                console.log(`\n🎉 DL Application Completed successfully!`);
                console.log(`Result:`, result);
            } catch (err) {
                console.error(`\n❌ Flow failed during OTP submission/finalization phase:`, err.message || err);
            }
        });
    } catch (err) {
        console.error(`\n❌ Flow failed during login/OTP generation phase:`, err.message || err);
        rl.close();
    }
}

run();
