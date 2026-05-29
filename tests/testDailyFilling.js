require('dotenv').config();
const CONFIG = require('../src/config/config');
CONFIG.PUPPETEER.HEADLESS = false;
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const dlRenewalService = require('../src/services/dlRenewalService');
const applyDlService = require('../src/services/applyDlService');
const paymentService = require('../src/services/paymentService');
const slotBookingService = require('../src/services/slotBookingService');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const inputFilePath = path.join(__dirname, '../scratch_input.txt');

const question = (query) => new Promise((resolve) => {
    console.log(query);
    // Delete existing scratch_input.txt if any, to avoid stale input
    if (fs.existsSync(inputFilePath)) {
        try { fs.unlinkSync(inputFilePath); } catch (e) {}
    }
    
    let resolved = false;
    
    // Check via readline (in case of interactive terminal)
    rl.question('', (answer) => {
        if (!resolved) {
            resolved = true;
            clearInterval(interval);
            resolve(answer);
        }
    });

    // Check via polling scratch_input.txt
    const interval = setInterval(() => {
        if (fs.existsSync(inputFilePath)) {
            try {
                const content = fs.readFileSync(inputFilePath, 'utf8').trim();
                if (content) {
                    resolved = true;
                    clearInterval(interval);
                    try { fs.unlinkSync(inputFilePath); } catch (e) {}
                    resolve(content);
                }
            } catch (e) {
                // Ignore read errors
            }
        }
    }, 1000);
});


function parseArgs() {
    const args = {};
    const rawArgs = process.argv.slice(2);
    for (let i = 0; i < rawArgs.length; i++) {
        if (rawArgs[i].startsWith('--')) {
            const key = rawArgs[i].slice(2);
            const val = rawArgs[i + 1] && !rawArgs[i + 1].startsWith('--') ? rawArgs[i + 1] : true;
            args[key] = val;
        }
    }
    return args;
}

async function main() {
    const args = parseArgs();
    const flow = args.flow;

    if (!flow) {
        console.log("Usage Examples:");
        console.log("  node tests/testDailyFilling.js --flow dl_renewal --dl <DL_NO> --dob <DOB> [--rto <RTO>]");
        console.log("  node tests/testDailyFilling.js --flow apply_dl --ll <LL_NO> --dob <DOB>");
        console.log("  node tests/testDailyFilling.js --flow pay_fee --appNo <APP_NO> --dob <DOB>");
        console.log("  node tests/testDailyFilling.js --flow slot_booking --appNo <APP_NO> --dob <DOB>");
        process.exit(1);
    }

    try {
        if (flow === 'dl_renewal') {
            const dl = args.dl;
            const dob = args.dob;
            const rto = args.rto || '';
            const mobile = args.mobile || '9999999999';
            const service = args.service || 'RENEWAL OF DL';

            if (!dl || !dob) {
                throw new Error("Missing --dl or --dob argument");
            }

            console.log(`[Test] Starting DL Flow for DL: ${dl}, DOB: ${dob}, RTO: ${rto}, Service: ${service}`);
            const session = await dlRenewalService.startDLRenewalFlow(dl, dob, rto, mobile, service);
            console.log("[Test] Phase 1 completed. OTP has been triggered.");

            const otp = await question("🔑 Enter the 6-digit OTP code received on mobile: ");
            console.log("[Test] Submitting OTP...");
            const result = await dlRenewalService.submitDLRenewalOTP(session.browser, session.context, session.page, otp.trim(), service);
            const resultFile = typeof result === 'object' && result !== null ? result.screenshotPath : result;
            console.log(`🎉 [Test] Success! DL Renewal file saved to: ${resultFile}`);

            const CONFIG = require('../src/config/config');
            const isHeadless = CONFIG.PUPPETEER.HEADLESS === 'new' || CONFIG.PUPPETEER.HEADLESS === true;
            if (!isHeadless) {
                console.log("\n⚠️ Headless mode is disabled; keeping browser open for inspection.");
                await question("⌨️ Press Enter to close browser and exit...");
            }

        } else if (flow === 'apply_dl') {
            const ll = args.ll;
            const dob = args.dob;
            const mobile = args.mobile || '9999999999';

            if (!ll || !dob) {
                throw new Error("Missing --ll or --dob argument");
            }

            console.log(`[Test] Starting Apply DL from LL Flow for LL: ${ll}, DOB: ${dob}`);
            const session = await applyDlService.startApplyDLFlow(ll, dob, mobile);
            console.log("[Test] Phase 1 completed. OTP has been triggered.");

            const otp = await question("🔑 Enter the 6-digit OTP code received on mobile: ");
            console.log("[Test] Submitting OTP...");
            const details = await applyDlService.submitApplyDLOTP(session.browser, session.context, session.page, otp.trim());
            console.log(`🎉 [Test] Success! DL Application details:\n`, details);

        } else if (flow === 'pay_fee') {
            const appNo = args.appNo;
            const dob = args.dob;

            if (!appNo || !dob) {
                throw new Error("Missing --appNo or --dob argument");
            }

            console.log(`[Test] Starting Payment Flow for AppNo: ${appNo}, DOB: ${dob}`);
            const session = await paymentService.startPaymentFlow(appNo, dob);
            console.log(`[Test] Phase 1 completed. QR code captured at: ${session.qrImagePath}`);
            console.log("[Test] Please scan the QR code to make the payment.");

            const confirm = await question("💸 Type 'paid' when payment is done: ");
            if (confirm.trim().toLowerCase() !== 'paid') {
                throw new Error("Payment abort or incorrect confirmation text");
            }

            console.log("[Test] Verifying payment and retrieving receipt...");
            const receiptFile = await paymentService.confirmPayment(session.browser, session.context, session.page, appNo);
            console.log(`🎉 [Test] Success! Receipt file saved to: ${receiptFile}`);

        } else if (flow === 'slot_booking') {
            const appNo = args.appNo;
            const dob = args.dob;

            if (!appNo || !dob) {
                throw new Error("Missing --appNo or --dob argument");
            }

            console.log(`[Test] Starting Slot Booking Flow for AppNo: ${appNo}, DOB: ${dob}`);
            const session = await slotBookingService.startSlotBookingFlow(appNo, dob);
            console.log(`[Test] Phase 1 completed. Calendar screenshot saved at: ${session.calendarScreenshotPath}`);

            const choice = await question("📅 Enter date to book (e.g. '29' or type 'auto' to auto-book first green slot): ");
            console.log("[Test] Processing slot choice...");
            if (choice.trim().toLowerCase() === 'auto') {
                await slotBookingService.bookPreferredSlot(session.context, session.page, null, null);
            } else {
                await slotBookingService.bookPreferredSlot(session.context, session.page, choice.trim(), null);
            }

            console.log("[Test] Slot selected. SMS OTP has been sent.");
            const otp = await question("🔑 Enter the SMS OTP received for booking confirmation: ");
            console.log("[Test] Confirming Slot Booked OTP...");
            const slipFile = await slotBookingService.confirmSlotBookingOTP(session.browser, session.context, session.page, otp.trim());
            console.log(`🎉 [Test] Success! Slot booking slip saved to: ${slipFile}`);

        } else {
            console.error(`Unknown flow: ${flow}`);
        }
    } catch (err) {
        console.error("❌ Test failed:", err);
    } finally {
        rl.close();
    }
}

main();
