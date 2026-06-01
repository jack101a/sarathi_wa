const { Worker } = require('bullmq');
const Redis = require('ioredis');
const { config: CONFIG, redis, subscriber, logger, rateLimiter, authorizationRepository: authRepo, jobRepository, queue } = require('@sarathi/common');
const fs = require('fs');
const path = require('path');

// Import services from monolith src
const llPrintService = require('../../../src/services/llPrintService');
const llEditService = require('../../../src/services/llEditService');
const dlRenewalService = require('../../../src/services/dlRenewalService');
const applyDlService = require('../../../src/services/applyDlService');
const paymentService = require('../../../src/services/paymentService');
const slotBookingService = require('../../../src/services/slotBookingService');
const dlInfoService = require('../../../src/services/dlInfoService');
const mobileUpdateService = require('../../../src/services/mobileUpdateService');
const chatNotifier = require('@sarathi/common').chatNotifier;

const interactiveSessions = new Map(); // jobId -> { resolve, reject }

// Subscribe to OTP/interactive inputs via Redis Pub/Sub
subscriber.on('message', (channel, message) => {
  if (channel.startsWith('otp:input:')) {
    const jobId = channel.replace('otp:input:', '');
    const session = interactiveSessions.get(jobId);
    if (session) {
      session.resolve(message);
    }
  }
});

async function waitInteractiveInput(chatId, jobId, timeoutMs = 300000) {
  await subscriber.subscribe(`otp:input:${jobId}`);

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(async () => {
      await subscriber.unsubscribe(`otp:input:${jobId}`);
      interactiveSessions.delete(jobId);
      await redis.del(`session:otp:${chatId}`).catch(() => {});
      reject(new Error('Session timed out waiting for user input (5 minutes).'));
    }, timeoutMs);

    interactiveSessions.set(jobId, {
      resolve: async (input) => {
        clearTimeout(timeoutId);
        await subscriber.unsubscribe(`otp:input:${jobId}`);
        interactiveSessions.delete(jobId);
        await redis.del(`session:otp:${chatId}`).catch(() => {});
        resolve(input);
      },
      reject: async (err) => {
        clearTimeout(timeoutId);
        await subscriber.unsubscribe(`otp:input:${jobId}`);
        interactiveSessions.delete(jobId);
        await redis.del(`session:otp:${chatId}`).catch(() => {});
        reject(err);
      }
    });
  });
}

function cleanup(p) { if (p && fs.existsSync(p)) fs.unlinkSync(p); }
async function sendText(t, c, x) { return t === 'telegram' ? chatNotifier.sendTelegramMessage(c, x) : chatNotifier.sendWhatsAppText(c, x); }
async function sendImageFile(t, c, p, cap = '') { const b = fs.readFileSync(p); const n = path.basename(p); return t === 'telegram' ? chatNotifier.sendTelegramPhoto(c, b, n, cap, 'image/png') : chatNotifier.sendWhatsAppMedia(c, b, 'image/png', n, cap); }
async function sendPdfFile(t, c, p, cap = '') { const b = fs.readFileSync(p); const n = path.basename(p); return t === 'telegram' ? chatNotifier.sendTelegramDocument(c, b, n, cap, 'application/pdf') : chatNotifier.sendWhatsAppMedia(c, b, 'application/pdf', n, cap); }

async function handleJob(job) {
  const payload = JSON.parse(job.payload_json || '{}');
  const transport = job.transport || 'whatsapp';
  const chatId = job.chat_id || payload.chatId;

  if (job.command === 'llprint_start') {
    const { context, page } = await llPrintService.startLLPrintFlow(payload.appNo, payload.dob, payload.mobile);
    await redis.setex(`session:otp:${chatId}`, 300, JSON.stringify({ jobId: job.id, status: 'awaiting_otp' }));
    await sendText(transport, chatId, '🔐 OTP has been sent. Please reply with the 6-digit OTP code to continue.');

    try {
      const otpCode = await waitInteractiveInput(chatId, job.id);
      const pdfPath = await llPrintService.submitLLPrintOTP(context, page, otpCode, payload.appNo, payload.dob);
      await sendPdfFile(transport, chatId, pdfPath, `✅ Learner Licence downloaded successfully for Application No: ${payload.appNo}`);
      cleanup(pdfPath);
      return { ok: true };
    } catch (error) {
      if (context) await context.close().catch(() => {});
      throw error;
    }
  }

  if (job.command === 'lledit_start') {
    const { context, page, dynamicData } = await llEditService.startLLEditFlow(payload.appNo, payload.dob, payload.mobile);
    await redis.setex(`session:otp:${chatId}`, 300, JSON.stringify({ jobId: job.id, status: 'awaiting_otp' }));
    await sendText(transport, chatId, '🔐 OTP has been sent. Please reply with the 6-digit OTP code to continue.');

    try {
      const otpCode = await waitInteractiveInput(chatId, job.id);
      await sendText(transport, chatId, '⏳ OTP received. Processing dynamic form filling and priming...');
      await llEditService.submitLLEditOTP(context, page, otpCode, payload.appNo, payload.dob, dynamicData);
      await sendText(transport, chatId, '✅ Bait-and-Switch successfully completed! Application updated and session primed.');
      return { ok: true };
    } catch (error) {
      if (context) await context.close().catch(() => {});
      throw error;
    }
  }

  if (job.command === 'dl_renewal_start') {
    const serviceType = payload.serviceType || 'RENEWAL OF DL';
    let flowData;
    try {
      flowData = await dlRenewalService.startDLRenewalFlow(payload.dlNo, payload.dob, payload.rtoCode, payload.mobile, serviceType);
      const { browser, context, page, maskedMobile } = flowData;
      
      const serviceName = serviceType.replace('OF DL', '').replace('ISSUE OF', '').trim().toLowerCase();
      const formattedServiceName = serviceName.charAt(0).toUpperCase() + serviceName.slice(1);
      const msg = `🔐 OTP has been sent successfully to your mobile number ${maskedMobile || '******'} for DL ${formattedServiceName}.\n\nPlease reply with the 6-digit OTP code to continue.`;

      await sendText(transport, chatId, msg);
      await redis.setex(`session:otp:${chatId}`, 300, JSON.stringify({ jobId: job.id, status: 'awaiting_otp' }));
      
      const otpCode = await waitInteractiveInput(chatId, job.id);
      await sendText(transport, chatId, `⏳ OTP received. Filling Self-Declaration Form 1 popup and submitting DL ${formattedServiceName}...`);
      
      const result = await dlRenewalService.submitDLRenewalOTP(browser, context, page, otpCode, serviceType);
      let slipPath, appNo;
      if (typeof result === 'object' && result !== null) {
        slipPath = result.screenshotPath;
        appNo = result.appNo;
      } else {
        slipPath = result;
      }

      if (slipPath) {
        await sendImageFile(transport, chatId, slipPath, `✅ DL ${formattedServiceName} Successful! Here is your acknowledgement reference slip.`);
        cleanup(slipPath);
      }

      if (appNo && appNo !== 'Unknown' && payload.dob) {
        try {
          await sendText(transport, chatId, '⏳ Automatically generating and downloading your formset...');
          const { getFormset } = require('../../../src/services/formsetService');
          const { buffer, filename } = await getFormset(appNo, payload.dob);
          if (transport === 'telegram') await chatNotifier.sendTelegramDocument(chatId, buffer, filename, '', 'application/pdf');
          else await chatNotifier.sendWhatsAppMedia(chatId, buffer, 'application/pdf', filename, '');
        } catch (e) {
          logger.error('worker-browser', `Formset generation failed: ${e.message}`);
        }
      }

      return { ok: true, appNo };
    } catch (error) {
      if (flowData) {
        if (flowData.context) await flowData.context.close().catch(() => {});
        if (flowData.browser) await flowData.browser.close().catch(() => {});
      }
      throw error;
    }
  }

  if (job.command === 'apply_dl_start') {
    let flowData;
    try {
      flowData = await applyDlService.startApplyDLFlow(payload.llNo, payload.dob, payload.mobile);
      const { browser, context, page, maskedMobile } = flowData;
      const msg = `🔐 OTP has been sent successfully to your mobile number ${maskedMobile || '******'} for DL Application.\n\nPlease reply with the 6-digit OTP code to continue.`;
      
      await sendText(transport, chatId, msg);
      await redis.setex(`session:otp:${chatId}`, 300, JSON.stringify({ jobId: job.id, status: 'awaiting_otp' }));
      
      const otpCode = await waitInteractiveInput(chatId, job.id);
      await sendText(transport, chatId, '⏳ OTP received. Booking class of vehicles, completing Self-Declaration Form 1, and finalising DL application...');
      
      const details = await applyDlService.submitApplyDLOTP(browser, context, page, otpCode);
      await sendText(transport, chatId, `✅ DL Application Submitted Successfully!\n📝 Application Details: ${details.extractedText}`);
      
      if (details.screenshotPath) {
        await sendImageFile(transport, chatId, details.screenshotPath, '📄 Here is your DL Application Acknowledgment Slip.');
        cleanup(details.screenshotPath);
      }

      const appNo = details.appNo || (details.extractedText && details.extractedText.match(/Application No\s*:\s*(\d+)/i)?.[1]);
      if (appNo && appNo !== 'Unknown' && payload.dob) {
        try {
          await sendText(transport, chatId, '⏳ Automatically generating and downloading your formset...');
          const { getFormset } = require('../../../src/services/formsetService');
          const { buffer, filename } = await getFormset(appNo, payload.dob);
          if (transport === 'telegram') await chatNotifier.sendTelegramDocument(chatId, buffer, filename, '', 'application/pdf');
          else await chatNotifier.sendWhatsAppMedia(chatId, buffer, 'application/pdf', filename, '');
        } catch (e) {
          logger.error('worker-browser', `Formset generation failed: ${e.message}`);
        }
      }

      return { ok: true, appNo };
    } catch (error) {
      if (flowData) {
        if (flowData.context) await flowData.context.close().catch(() => {});
        if (flowData.browser) await flowData.browser.close().catch(() => {});
      }
      throw error;
    }
  }

  if (job.command === 'pay_fee_start') {
    let flowData;
    try {
      flowData = await paymentService.startPaymentFlow(payload.appNo, payload.dob);
      const { browser, context, page, qrImagePath } = flowData;
      
      const qrBuffer = fs.readFileSync(qrImagePath);
      const caption = `💸 Scan this QR Code to pay the application fee for Application No: ${payload.appNo}.\n\nOnce paid, please reply with "paid" to download your print receipt.`;
      
      if (transport === 'telegram') await chatNotifier.sendTelegramPhoto(chatId, qrBuffer, 'qr.png', caption);
      else await chatNotifier.sendWhatsAppImage(chatId, qrBuffer, 'qr.png', caption);
      cleanup(qrImagePath);

      await redis.setex(`session:otp:${chatId}`, 300, JSON.stringify({ jobId: job.id, status: 'awaiting_payment_confirmation' }));
      
      const userConfirmation = await waitInteractiveInput(chatId, job.id);
      if (!/^paid$/i.test(userConfirmation)) {
        throw new Error('Payment confirmation cancelled by user or invalid response.');
      }

      await sendText(transport, chatId, '⏳ Payment marked as paid. Waiting for portal redirect and downloading receipt...');
      const receiptPath = await paymentService.confirmPayment(browser, context, page, payload.appNo);
      await sendPdfFile(transport, chatId, receiptPath, `✅ Payment receipt downloaded successfully for Application No: ${payload.appNo}.`);
      cleanup(receiptPath);
      return { ok: true };
    } catch (error) {
      if (flowData) {
        if (flowData.context) await flowData.context.close().catch(() => {});
        if (flowData.browser) await flowData.browser.close().catch(() => {});
      }
      throw error;
    }
  }

  if (job.command === 'slot_booking_start') {
    let flowData;
    try {
      flowData = await slotBookingService.startSlotBookingFlow(payload.appNo, payload.dob);
      const { browser, context, page, calendarScreenshotPath } = flowData;
      
      const calendarBuffer = fs.readFileSync(calendarScreenshotPath);
      const caption = `📅 Here are the available slots for Application No: ${payload.appNo}.\n\nReply with "auto" to book the first available green slot, or specify a date like "29" or "YYYY-MM-DD 13:00".`;
      
      if (transport === 'telegram') await chatNotifier.sendTelegramPhoto(chatId, calendarBuffer, 'calendar.png', caption);
      else await chatNotifier.sendWhatsAppImage(chatId, calendarBuffer, 'calendar.png', caption);
      cleanup(calendarScreenshotPath);

      await redis.setex(`session:otp:${chatId}`, 300, JSON.stringify({ jobId: job.id, status: 'awaiting_slot_selection' }));
      const choice = await waitInteractiveInput(chatId, job.id);

      await sendText(transport, chatId, '⏳ Caching slot date, triggering booking SMS OTP...');
      if (/^auto$/i.test(choice)) {
        await slotBookingService.bookPreferredSlot(context, page, null, null);
      } else {
        await slotBookingService.bookPreferredSlot(context, page, choice, null);
      }

      await sendText(transport, chatId, '🔐 SMS OTP has been sent for booking confirmation. Please reply with the OTP code.');
      await redis.setex(`session:otp:${chatId}`, 300, JSON.stringify({ jobId: job.id, status: 'awaiting_booking_otp' }));
      
      const otpCode = await waitInteractiveInput(chatId, job.id);
      await sendText(transport, chatId, '⏳ Submitting slot booking OTP and generating confirmation...');
      
      const docPath = await slotBookingService.confirmSlotBookingOTP(browser, context, page, otpCode);
      await sendPdfFile(transport, chatId, docPath, '🎉 Slot Booked Successfully! Here is your booking confirmation slip.');
      cleanup(docPath);
      return { ok: true };
    } catch (error) {
      if (flowData) {
        if (flowData.context) await flowData.context.close().catch(() => {});
        if (flowData.browser) await flowData.browser.close().catch(() => {});
      }
      throw error;
    }
  }

  if (job.command === 'fee_print_start') {
    const receiptPath = await paymentService.printExistingReceipt(payload.appNo, payload.dob);
    const isPdf = String(receiptPath).toLowerCase().endsWith('.pdf');
    const caption = `✅ Here is your official fee payment receipt for Application No: ${payload.appNo}.`;
    if (isPdf) {
      await sendPdfFile(transport, chatId, receiptPath, caption);
    } else {
      await sendImageFile(transport, chatId, receiptPath, caption);
    }
    cleanup(receiptPath);
    return { ok: true };
  }

  if (job.command === 'dl_info_start') {
    const resultPath = await dlInfoService.fetchAndRenderDLInfo(payload.dlNo, payload.dob);
    const caption = `✅ Driving Licence Details for DL No: ${payload.dlNo}`;
    await sendImageFile(transport, chatId, resultPath, caption);
    cleanup(resultPath);
    return { ok: true };
  }

  if (job.command === 'mobupdate_start') {
    let flowData;
    try {
      flowData = await mobileUpdateService.startMobileUpdateFlow(payload.dlNo, payload.dob);
      const { browser, context, page } = flowData;
      
      await sendText(transport, chatId, 'Send Aadhaar number (12 digits):');
      await redis.setex(`session:otp:${chatId}`, 300, JSON.stringify({ jobId: job.id, status: 'awaiting_aadhaar' }));
      
      const aadhaar = await waitInteractiveInput(chatId, job.id);
      if (aadhaar.length !== 12 || !/^\d+$/.test(aadhaar)) {
        throw new Error('Invalid Aadhaar number format.');
      }

      await sendText(transport, chatId, '⏳ Generating Aadhaar OTP...');
      await mobileUpdateService.generateAadhaarOtp(page, aadhaar);

      await sendText(transport, chatId, '🔑 Enter Aadhaar OTP:');
      await redis.setex(`session:otp:${chatId}`, 300, JSON.stringify({ jobId: job.id, status: 'awaiting_aadhaar_otp' }));
      
      const aadhaarOtp = await waitInteractiveInput(chatId, job.id);
      await sendText(transport, chatId, '⏳ Authenticating Aadhaar e-KYC...');
      await mobileUpdateService.authenticateAadhaar(page, aadhaarOtp);

      await sendText(transport, chatId, '✅ Aadhaar verified. Send new mobile number:');
      await redis.setex(`session:otp:${chatId}`, 300, JSON.stringify({ jobId: job.id, status: 'awaiting_new_mobile' }));
      
      const newMobile = await waitInteractiveInput(chatId, job.id);
      if (newMobile.length !== 10 || !/^\d+$/.test(newMobile)) {
        throw new Error('Invalid mobile number format.');
      }

      await sendText(transport, chatId, '⏳ Sending OTP to new mobile...');
      await page.evaluate(async (newMob) => {
        const baseUrl = "https://sarathi.parivahan.gov.in/sarathiservice";
        await fetch(`${baseUrl}/checkMobCount.do`, {
            method: "POST",
            headers: {
                "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                "x-requested-with": "XMLHttpRequest"
            },
            body: new URLSearchParams({ MobNum: newMob }),
            credentials: "include" 
        });
        let timestamp = Date.now();
        await fetch(`${baseUrl}/sendOTPInMobNumUpd.do?newMobNum=${newMob}&_=${timestamp}`, {
            method: "GET",
            headers: { "x-requested-with": "XMLHttpRequest" },
            credentials: "include"
        });
      }, newMobile);

      await sendText(transport, chatId, '🔑 Enter Mobile OTP:');
      await redis.setex(`session:otp:${chatId}`, 300, JSON.stringify({ jobId: job.id, status: 'awaiting_mobile_otp' }));
      
      const mobileOtp = await waitInteractiveInput(chatId, job.id);
      await sendText(transport, chatId, '⏳ Completing mobile update on portal...');
      
      const result = await mobileUpdateService.executeBypassScript(page, newMobile, mobileOtp);
      if (result.screenshotPath) {
        const caption = result.success 
          ? `🎉 Updated to ${newMobile}!` 
          : `❌ Update may have failed. Check preview.`;
        await sendImageFile(transport, chatId, result.screenshotPath, caption);
        cleanup(result.screenshotPath);
        if (!result.success) {
          throw new Error('Mobile update failed on portal.');
        }
      } else {
        throw new Error('Mobile update failed. No confirmation page screenshot.');
      }

      if (context) await context.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
      return { ok: true };
    } catch (error) {
      if (flowData) {
        if (flowData.context) await flowData.context.close().catch(() => {});
        if (flowData.browser) await flowData.browser.close().catch(() => {});
      }
      throw error;
    }
  }

  throw new Error(`Unsupported browser command: ${job.command}`);
}

function startBrowserWorker() {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const concurrency = CONFIG.QUEUE.BROWSER_CONCURRENCY || 1;

  const worker = new Worker(queue.BROWSER_QUEUE_NAME, async (bullJob) => {
    const job = bullJob.data;
    logger.info('worker-browser', `Starting job ${job.id}: command=${job.command}`);
    await jobRepository.updateJobStatus(job.id, 'running');

    try {
      const result = await handleJob(job);
      await jobRepository.updateJobStatus(job.id, 'completed', JSON.stringify(result || {}), '');
      
      // Perform usage and credit deductions in PostgreSQL
      if (rateLimiter.isHeavyCommand(job.command) && job.user_id) {
        const cost = rateLimiter.getCreditCost(job.command);
        let deducted = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            await authRepo.deductCreditsAudited(job.user_id, cost, `Heavy job completion: ${job.command}`, job.id);
            logger.info('worker-browser', `Deducted ${cost} credits from user ${job.user_id} for ${job.command}`);
            deducted = true;
            break;
          } catch (err) {
            logger.error('worker-browser', `Credit deduction attempt ${attempt}/3 failed for user ${job.user_id}`, { error: err.message });
            if (attempt < 3) await new Promise(r => setTimeout(r, 1000 * attempt));
          }
        }
        if (!deducted) {
          logger.error('worker-browser', `CRITICAL: Credit deduction FAILED after 3 attempts for user ${job.user_id}, job ${job.id}. Manual reconciliation needed.`);
          try {
            await jobRepository.updateJobStatus(job.id, 'completed', JSON.stringify({ ...(result || {}), billing_failed: true }), '');
          } catch (_) {}
        }
      } else if (job.user_id) {
        try {
          await authRepo.incrementUsage(job.user_id);
          await rateLimiter.recordRequest(job.user_id, job.command);
        } catch (err) {
          logger.error('worker-browser', `Failed to record rate limit for user ${job.user_id}`, { error: err.message });
        }
      }

      return result;
    } catch (error) {
      const errMsg = error.message || String(error);
      logger.error('worker-browser', `Job ${job.id} failed: ${errMsg}`);
      await jobRepository.updateJobStatus(job.id, 'failed', '{}', errMsg);

      const webhookUrl = process.env.DISCORD_WEBHOOK_URL || process.env.DISCORD_WEBHOOK;
      if (webhookUrl) {
        try {
          const title = `🔴 Job Exception: ${job.command}`;
          const description = `**Job ID:** \`${job.id}\`\n` +
            `**User Phone:** ${job.user_phone || 'Unknown'}\n` +
            `**Queue:** browser\n` +
            `**Error:** \`\`\`${errMsg}\`\`\``;
          await chatNotifier.sendDiscordAlert(title, description, 'error');
        } catch (_) {}
      }

      throw error;
    }
  }, {
    connection,
    concurrency
  });

  worker.on('failed', (bullJob, err) => {
    logger.warn('worker-browser', `BullMQ job failed`, { jobId: bullJob ? bullJob.id : 'unknown', error: err.message });
  });

  console.log(`[Worker-Browser] Worker started with concurrency=${concurrency}`);
  return worker;
}

module.exports = {
  startBrowserWorker
};
