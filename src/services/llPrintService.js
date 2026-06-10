const { chromium, firefox } = require('playwright');
const path = require('path');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');
const { solveSarathiCaptcha } = require('./sarathiCaptchaSolver');

const BASE_URL = "https://sarathi.parivahan.gov.in/sarathiservice";
const CAPTCHA_RULES = [
    { src: "#capimg1", tgt: "#entcaptxt1" },
    { src: "#capimg", tgt: "#captxt1" },
    { src: "#capimg", tgt: "#entCaptha" },
    { src: "#capimg", tgt: "#entcaptxt" },
    { src: "#captchaImg", tgt: "#captcha" },
    { src: "#captchaImg", tgt: "#captchatext" },
    { src: "#capimg", tgt: "input[name='captxt']" },
    { src: "img[src*='captchaimage.jsp']", tgt: "input[name='captxt']" },
];

// ---------------------------------------------------------------------------
// PROFILE POOL — 5 fixed Firefox profile directories, one per concurrent user.
//
// Why fixed profiles instead of temp dirs?
//   - Firefox locks a profile while it's in use. A fresh temp dir has no
//     pre-warmed state and can behave differently per OS.  Fixed, pre-created
//     dirs are stable, reusable, and never have cross-session lock conflicts.
//
// How it works:
//   1. acquireProfile()  → picks a free slot (0-4), marks it busy, returns
//                          the profile path.  If all 5 are busy the caller
//                          waits in a Promise queue.
//   2. releaseProfile()  → marks the slot free again and unblocks the next
//                          waiter (if any) from the queue.
// ---------------------------------------------------------------------------
const MAX_PROFILES = 5;
const PROFILE_BASE = path.join(process.cwd(), "firefox_profiles");

// Ensure all profile directories exist at startup
for (let i = 0; i < MAX_PROFILES; i++) {
    const dir = path.join(PROFILE_BASE, `profile_${i}`);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const profileBusy = new Array(MAX_PROFILES).fill(false); // slot → in-use?
const profileQueue = []; // waiters: Array of { resolve, slotIndex } — actually just resolve fns

function acquireProfile() {
    // Find a free slot
    const freeIdx = profileBusy.findIndex(busy => !busy);
    if (freeIdx !== -1) {
        profileBusy[freeIdx] = true;
        const profilePath = path.join(PROFILE_BASE, `profile_${freeIdx}`);
        console.log(`[ProfilePool] Acquired profile slot ${freeIdx}: ${profilePath}`);
        return Promise.resolve({ slotIdx: freeIdx, profilePath });
    }

    // All busy — wait in queue
    console.log(`[ProfilePool] All ${MAX_PROFILES} slots busy. Request queued (queue length: ${profileQueue.length + 1})`);
    return new Promise(resolve => profileQueue.push(resolve));
}

function releaseProfile(slotIdx) {
    if (profileQueue.length > 0) {
        // Hand this slot directly to the next waiter
        const nextResolve = profileQueue.shift();
        const profilePath = path.join(PROFILE_BASE, `profile_${slotIdx}`);
        console.log(`[ProfilePool] Slot ${slotIdx} handed to next queued request.`);
        nextResolve({ slotIdx, profilePath });
        // slot stays "busy" — the new owner is responsible for releasing it
    } else {
        profileBusy[slotIdx] = false;
        console.log(`[ProfilePool] Released profile slot ${slotIdx}. (${profileBusy.filter(b => b).length}/${MAX_PROFILES} in use)`);
    }
}
// ---------------------------------------------------------------------------

async function solveOcr(imageBytes) {
    const result = await solveSarathiCaptcha(imageBytes);
    return result;
}

async function smartSolveCaptcha(page, stepName) {
    console.log(`[${stepName}] Solving CAPTCHA...`);
    await page.waitForTimeout(1000);

    for (const rule of CAPTCHA_RULES) {
        const tgtLoc = page.locator(rule.tgt);
        const srcLoc = page.locator(rule.src);

        if (await tgtLoc.isVisible()) {
            await tgtLoc.click();
            await tgtLoc.fill("");

            await srcLoc.waitFor({ state: "visible", timeout: 5000 });
            await page.waitForTimeout(1000);

            const imgBytes = await srcLoc.screenshot();
            const solvedText = await solveOcr(imgBytes);

            if (!solvedText) {
                console.log("    -> ❌ OCR failed to read UI Captcha.");
                return false;
            }

            console.log(`    -> ✅ Solved: ${solvedText}`);

            await tgtLoc.pressSequentially(solvedText, { delay: 100 });
            await tgtLoc.press("Tab");
            await page.mouse.click(0, 0);

            return true;
        }
    }
    return false;
}

async function startLLPrintFlow(appNum, dob, mobile) {
    console.log(`🚀 [${appNum}] Requesting profile slot...`);

    // Claim a profile slot (waits in queue if all 5 are busy)
    const { slotIdx, profilePath } = await acquireProfile();

    console.log("🚀 Starting LL Print Flow...");

    const firefoxPrefs = {
        "dom.disable_open_during_load": false,
        "privacy.popups.showBrowserMessage": false,
        "pdfjs.disabled": false,
        "browser.download.folderList": 1,
        "browser.download.manager.showWhenStarting": false,
        "security.insecure_field_warning.contextual.enabled": false,
        "security.certerrors.mitm.auto_enable_enterprise_roots": true,
    };

    let context;
    try {
        context = await firefox.launchPersistentContext(profilePath, {
            headless: true,
            firefoxUserPrefs: firefoxPrefs,
            acceptDownloads: true,
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
        });

        const pages = context.pages();
        const page = pages.length > 0 ? pages[0] : await context.newPage();

        await page.goto(`${BASE_URL}/stateSelection.do`);

        try {
            await page.getByLabel("Close").click({ timeout: 2000 });
        } catch (e) { }

        console.log(" Selecting State...");
        await Promise.all([
            page.waitForNavigation(),
            page.locator("#stfNameId").selectOption("MH")
        ]);

        try {
            await page.getByRole("button", { name: "x" }).click({ timeout: 2000 });
        } catch (e) { }

        console.log(" Navigating to DL Search...");
        await page.getByRole("link", { name: "Learner Licence", exact: true }).click();
        await page.getByRole("link", { name: "Others", exact: true }).click();
        await page.getByRole("link", { name: "Others", exact: true }).click();
        await page.getByRole("link", { name: "DL Search" }).click();

        console.log("\n Triggering OTP...");
        let otpTriggered = false;

        while (!otpTriggered) {
            const mobileField = page.locator("#mobileNumber");
            await mobileField.click();
            await mobileField.fill("");
            await mobileField.pressSequentially(mobile, { delay: 50 });

            await smartSolveCaptcha(page, "Tab 1: SMS");

            const btn = page.locator("#generateSarathiotp");
            await page.waitForTimeout(1500);

            if (await btn.isDisabled()) {
                await page.evaluate("document.getElementById('generateSarathiotp').removeAttribute('disabled')");
            }

            await btn.click();
            await page.waitForTimeout(2000);

            if (await page.locator("#otpNumberSarathi").isVisible()) {
                otpTriggered = true;
            } else {
                await page.getByRole("img", { name: "Click Here to Refresh Captcha" }).click();
                await page.waitForTimeout(1000);
            }
        }

        // Return context and page so we can keep it alive.
        // slotIdx is stored internally so submitLLPrintOTP can release it via context._llSlotIdx.
        context._llSlotIdx = slotIdx;
        return { context, page };

    } catch (error) {
        console.error("❌ Error in startLLPrintFlow:", error);
        if (context) {
            await context.close().catch(() => {});
        }
        releaseProfile(slotIdx); // Free slot for the next user on failure
        throw error;
    }
}

async function closeLLPrintFlow(context) {
    if (!context) return;

    await context.close().catch(() => {});
    const slotIdx = context._llSlotIdx;
    if (slotIdx !== undefined) {
        releaseProfile(slotIdx);
        context._llSlotIdx = undefined;
    }
}

// Signature matches all callers in bot.js and telegramBot.js:
//   submitLLPrintOTP(flow.context, flow.page, otpCode, flow.appNo, flow.dob)
async function submitLLPrintOTP(context, page, otpCode, appNum, dob) {
    let downloadSuccess = false;
    let outputPath = path.join(process.cwd(), `LL_${appNum}.pdf`);

    try {
        console.log("\n Priming Print Data via Background Fetch...");

        const timestamp = Date.now();
        const captchaResp = await page.request.get(`${BASE_URL}/jsp/common/captchaimage.jsp?${timestamp}`, {
            headers: {
                "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                "Referer": `${BASE_URL}/dlSearch.do`,
                "Sec-Fetch-Dest": "image",
                "Sec-Fetch-Mode": "no-cors",
                "Sec-Fetch-Site": "same-origin",
            }
        });

        const primeCaptchaBytes = await captchaResp.body();
        const primeCaptchaText = await solveOcr(primeCaptchaBytes);

        if (!primeCaptchaText) {
            console.log("    -> ❌ OCR failed on Background Captcha. Exiting.");
            throw new Error("OCR failed on Background Captcha");
        }

        console.log(`    -> ✅ Background CAPTCHA Solved: ${primeCaptchaText}`);

        const fetchJs = `
            fetch("${BASE_URL}/sendOtp.do", {
                "headers": {
                    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "content-type": "application/x-www-form-urlencoded",
                    "pragma": "no-cache"
                },
                "referrer": "${BASE_URL}/printlearerslicence.do",
                "body": "listwise=1&applNum=${appNum}&hiddenOtp=&licNum=&mobileNum=&dateOfBirth=${dob}&captxt=${primeCaptchaText}&newll.submit=Submit",
                "method": "POST",
                "mode": "cors",
                "credentials": "include"
            }).then(response => response.status);
        `;

        const fetchStatus = await page.evaluate(fetchJs);
        console.log(`    -> Priming Fetch executed. Server returned HTTP ${fetchStatus}`);


        console.log("\n Final eKYC Authentication...");

        // Set up PDF response listener BEFORE the retry loop so we never miss a PDF
        const pdfResponses = [];
        context.on("response", response => {
            const contentType = (response.headers()["content-type"] || "").toLowerCase();
            if (contentType.includes("application/pdf")) {
                pdfResponses.push(response);
            }
        });

        const finalSubmitBtn = page.locator("#otpsubmit");
        const MAX_CAPTCHA_RETRIES = 3;
        let otpSubmitSuccess = false;

        for (let attempt = 1; attempt <= MAX_CAPTCHA_RETRIES; attempt++) {
            console.log(`    -> OTP Submit attempt ${attempt}/${MAX_CAPTCHA_RETRIES}...`);

            // Refresh captcha image before every attempt
            await page.getByRole("img", { name: "Click Here to Refresh Captcha" }).click();
            await page.waitForTimeout(1500);

            // Re-fill OTP and solve captcha fresh each attempt
            await page.locator("#otpNumberSarathi").fill(otpCode);
            await smartSolveCaptcha(page, `Final Auth attempt ${attempt}`);
            await page.locator("#otpCheckbox").check();

            console.log("    -> Clicking 'Submit OTP'...");
            await page.getByRole("button", { name: "Submit OTP" }).click();

            // Wait for #otpsubmit with a shorter per-attempt timeout
            try {
                await finalSubmitBtn.waitFor({ state: "visible", timeout: 15000 });
                console.log(`    -> ✅ #otpsubmit appeared on attempt ${attempt}.`);
                otpSubmitSuccess = true;
                break; // Success — exit retry loop
            } catch (waitErr) {
                console.log(`    -> ❌ #otpsubmit not visible on attempt ${attempt}. Checking error...`);

                // Read any server error message
                const errorMsgLoc = page.locator(".alert-danger, #errorMessages, .error-message, span[style*='color: red']").first();
                let errText = "Unknown error (likely incorrect OTP or Captcha).";
                if (await errorMsgLoc.isVisible().catch(() => false)) {
                    errText = (await errorMsgLoc.textContent()).trim();
                }
                console.log(`    -> Server message: "${errText}"`);

                // If the error explicitly mentions OTP being wrong/expired, no point retrying
                const isOtpError = /invalid otp|otp.*expired|incorrect otp|wrong otp/i.test(errText);
                if (isOtpError) {
                    console.log("    -> OTP itself is invalid/expired. Not retrying.");
                    await page.screenshot({ path: `debug_llprint_${appNum}.png`, fullPage: true }).catch(() => {});
                    const error = new Error(`Failed to reach final submit button. Server says: ${errText}`);
                    error.code = 'PORTAL_BUSINESS_RULE';
                    error.publicMessage = errText;
                    throw error;
                }

                // Captcha-related failure — will retry if attempts remain
                if (attempt === MAX_CAPTCHA_RETRIES) {
                    await page.screenshot({ path: `debug_llprint_${appNum}.png`, fullPage: true }).catch(() => {});
                    const error = new Error(`Failed to reach final submit button after ${MAX_CAPTCHA_RETRIES} attempts. Server says: ${errText}`);
                    error.code = 'PORTAL_BUSINESS_RULE';
                    error.publicMessage = errText;
                    throw error;
                }

                console.log(`    -> Likely captcha mismatch. Retrying...`);
                await page.waitForTimeout(1000);
            }
        }

        if (!otpSubmitSuccess) {
            throw new Error("OTP submit failed after all retries.");
        }

        console.log("\n Launching Final PDF Download...");


        try {
            const [download] = await Promise.all([
                page.waitForEvent('download', { timeout: 20000 }).catch(() => null),
                finalSubmitBtn.click()
            ]);

            if (download) {
                console.log("    -> ✅ Download event captured!");
                await download.saveAs(outputPath);
                downloadSuccess = true;
            }
        } catch (e) {
            console.log(`    -> Info: Download event failed or timed out (${e}). Trying fallbacks...`);
        }

        if (!downloadSuccess && pdfResponses.length > 0) {
            console.log(`    -> Found ${pdfResponses.length} PDF responses. Saving first one...`);
            try {
                const pdfBytes = await pdfResponses[0].body();
                fs.writeFileSync(outputPath, pdfBytes);
                console.log("    -> ✅ PDF captured from response body!");
                downloadSuccess = true;
            } catch (re) {
                console.log(`    -> Failed to read response body: ${re}`);
            }
        }

        if (!downloadSuccess) {
            const allPages = context.pages();
            if (allPages.length > 1) {
                const lastPage = allPages[allPages.length - 1];
                console.log(`    -> Trying direct request for last page URL: ${lastPage.url()}`);
                try {
                    const resp = await context.request.get(lastPage.url());
                    if (resp.status() === 200 && (resp.headers()["content-type"] || "").toLowerCase().includes("application/pdf")) {
                        const pdfBytes = await resp.body();
                        fs.writeFileSync(outputPath, pdfBytes);
                        console.log("    -> ✅ Direct download successful from page URL!");
                        downloadSuccess = true;
                    }
                } catch (ue) {
                    console.log(`    -> Direct request failed: ${ue}`);
                }
            }
        }

        if (downloadSuccess) {
            console.log(`🎉 PDF downloaded. Now cropping and stacking multiple pages...`);
            
            // Post-process the PDF to crop and stack LLs
            try {
                const pdfBytes = fs.readFileSync(outputPath);
                const pdfDoc = await PDFDocument.load(pdfBytes);
                const pages = pdfDoc.getPages();
                
                const mergedDoc = await PDFDocument.create();
                const A4_WIDTH = 595.28;
                const A4_HEIGHT = 841.89;
                
                const pageTopMargin = 20;
                const firstPageTopTrim = 45;
                const otherPagesTopTrim = 45;
                const cropHeight = 185;
                const gap = 0;
                
                let currentPage = mergedDoc.addPage([A4_WIDTH, A4_HEIGHT]);
                let currentY = A4_HEIGHT - pageTopMargin;
                
                for (let i = 0; i < pages.length; i++) {
                    const origPage = pages[i];
                    const { width, height } = origPage.getSize();
                    
                    const topTrim = i === 0 ? firstPageTopTrim : otherPagesTopTrim;
                    const cropTop = height - topTrim;
                    const cropBottom = cropTop - cropHeight;
                    
                    const boundingBox = {
                        left: 0,
                        bottom: cropBottom,
                        right: width,
                        top: cropTop,
                    };
                    
                    const [embeddedCroppedPage] = await mergedDoc.embedPages([origPage], [boundingBox]);
                    
                    if (currentY - cropHeight < 0) {
                        currentPage = mergedDoc.addPage([A4_WIDTH, A4_HEIGHT]);
                        currentY = A4_HEIGHT - pageTopMargin;
                    }
                    
                    currentY -= cropHeight;
                    
                    currentPage.drawPage(embeddedCroppedPage, {
                        x: 0,
                        y: currentY,
                        width: width,
                        height: cropHeight,
                    });
                    
                    currentY -= gap;
                }
                
                const mergedBytes = await mergedDoc.save();
                fs.writeFileSync(outputPath, mergedBytes);
                console.log(`🎉 MISSION ACCOMPLISHED! Cropped PDF saved as ${outputPath}`);
            } catch (cropErr) {
                console.log(`❌ Cropping failed, falling back to original PDF: ${cropErr}`);
            }

            return outputPath;
        } else {
            throw new Error("All PDF download strategies failed.");
        }
    } catch (e) {
        console.log(`❌ Critical error during final download: ${e}`);
        throw e;
    } finally {
        await page.waitForTimeout(3000);
        await closeLLPrintFlow(context);
    }
}

module.exports = {
    startLLPrintFlow,
    closeLLPrintFlow,
    submitLLPrintOTP
};
