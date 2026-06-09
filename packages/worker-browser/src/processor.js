const { Worker } = require('bullmq');
const { config: CONFIG, redis, subscriber, logger, rateLimiter, authorizationRepository: authRepo, jobRepository, queue, redisConfig, userFacingErrors } = require('@sarathi/common');
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
const { buildDlApplicationSummary } = require('../../../src/utils/serviceMessages');
const chatNotifier = require('@sarathi/common').chatNotifier;

const interactiveSessions = new Map(); // jobId -> { resolve, reject }
const INTERACTIVE_TIMEOUT_MS = 5 * 60 * 1000;

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

async function waitInteractiveInput(chatId, jobId, timeoutMs = INTERACTIVE_TIMEOUT_MS, onReady = null) {
  const startedAt = Date.now();
  await subscriber.subscribe(`otp:input:${jobId}`);
  const remainingMs = Math.max(1, timeoutMs - (Date.now() - startedAt));

  const inputPromise = new Promise((resolve, reject) => {
    const timeoutId = setTimeout(async () => {
      await subscriber.unsubscribe(`otp:input:${jobId}`);
      interactiveSessions.delete(jobId);
      await redis.del(`session:otp:${chatId}`).catch(() => {});
      const error = new Error('Interactive session timed out.');
      error.code = 'INTERACTIVE_TIMEOUT';
      reject(error);
    }, remainingMs);

    interactiveSessions.set(jobId, {
      resolve: async (input) => {
        clearTimeout(timeoutId);
        await subscriber.unsubscribe(`otp:input:${jobId}`);
        interactiveSessions.delete(jobId);
        await redis.del(`session:otp:${chatId}`).catch(() => {});
        if (/^(?:stop|cancel)$/i.test(String(input || '').trim())) {
          const error = new Error('Interactive session cancelled by user.');
          error.code = 'INTERACTIVE_CANCELLED';
          reject(error);
          return;
        }
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

  if (onReady) {
    try {
      await onReady();
    } catch (error) {
      const session = interactiveSessions.get(jobId);
      if (session) await session.reject(error);
    }
  }

  return inputPromise;
}

function cleanup(p) { if (p && fs.existsSync(p)) fs.unlinkSync(p); }
async function sendText(t, c, x) { return t === 'telegram' ? chatNotifier.sendTelegramMessage(c, x) : chatNotifier.sendWhatsAppText(c, x); }
async function sendImageFile(t, c, p, cap = '') { const b = fs.readFileSync(p); const n = path.basename(p); return t === 'telegram' ? chatNotifier.sendTelegramPhoto(c, b, n, cap, 'image/png') : chatNotifier.sendWhatsAppMedia(c, b, 'image/png', n, cap); }
async function sendPdfFile(t, c, p, cap = '') { const b = fs.readFileSync(p); const n = path.basename(p); return t === 'telegram' ? chatNotifier.sendTelegramDocument(c, b, n, cap, 'application/pdf') : chatNotifier.sendWhatsAppMedia(c, b, 'application/pdf', n, cap); }

async function promptAndWaitForInput(transport, chatId, jobId, status, prompt, validator = null, errorMsg = 'Invalid input. Please try again.') {
  let attempt = 0;
  while (attempt < 3) {
    const input = await waitInteractiveInput(chatId, jobId, INTERACTIVE_TIMEOUT_MS, async () => {
      await redis.setex(`session:otp:${chatId}`, 300, JSON.stringify({ jobId, status }));
      await sendText(transport, chatId, attempt === 0 ? prompt : errorMsg);
    });
    
    if (!validator) return input;
    
    let cleanInput = String(input || '').trim();
    if (validator(cleanInput)) return cleanInput;
    attempt++;
  }
  throw new Error('Too many invalid attempts. Session cancelled.');
}

const is6DigitOtp = (val) => /^\d{6}$/.test(String(val).trim());

function getBillingInfo(job) {
  const payload = JSON.parse(job.payload_json || '{}');
  const billing = payload.__billing || {};
  return {
    creditReserved: Boolean(job.credit_reserved || billing.creditReserved),
    creditCost: Number(job.credit_cost || billing.creditCost || 0),
  };
}

async function handleJob(job) {
  const payload = JSON.parse(job.payload_json || '{}');
  const transport = job.transport || 'whatsapp';
  const chatId = job.chat_id || payload.chatId;

  if (job.command === 'llprint_start') {
    const { context, page } = await llPrintService.startLLPrintFlow(payload.appNo, payload.dob, payload.mobile);

    try {
      const otpCode = await promptAndWaitForInput(
        transport,
        chatId,
        job.id,
        'awaiting_otp',
        'OTP has been sent. Please reply with the 6-digit OTP within 5 minutes.',
        is6DigitOtp,
        'Invalid OTP format. Please reply with exactly 6 digits.'
      );
      const pdfPath = await llPrintService.submitLLPrintOTP(context, page, otpCode, payload.appNo, payload.dob);
      await sendPdfFile(transport, chatId, pdfPath, `Learner Licence downloaded successfully for Application No: ${payload.appNo}`);
      cleanup(pdfPath);
      return { ok: true };
    } catch (error) {
      await llPrintService.closeLLPrintFlow(context);
      throw error;
    }
  }

  if (job.command === 'lledit_start') {
    const { browser, context, page, dynamicData } = await llEditService.startLLEditFlow(payload.appNo, payload.dob, payload.mobile);

    try {
      const otpCode = await promptAndWaitForInput(
        transport,
        chatId,
        job.id,
        'awaiting_otp',
        'OTP has been sent. Please reply with the 6-digit OTP within 5 minutes.',
        is6DigitOtp,
        'Invalid OTP format. Please reply with exactly 6 digits.'
      );
      await sendText(transport, chatId, 'OTP received. Completing your request...');
      await llEditService.submitLLEditOTP(context, page, otpCode, payload.appNo, payload.dob, dynamicData);
      await sendText(transport, chatId, 'Application updated successfully.');
      await browser.close().catch(() => {});
      return { ok: true };
    } catch (error) {
      if (context) await context.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
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
      const msg = `OTP has been sent to mobile number ${maskedMobile || '******'} for DL ${formattedServiceName}.\n\nPlease reply with the 6-digit OTP within 5 minutes.`;

      const otpCode = await promptAndWaitForInput(transport, chatId, job.id, 'awaiting_otp', msg, is6DigitOtp, 'Invalid OTP format. Please reply with exactly 6 digits.');
      await sendText(transport, chatId, '⏳ OTP received...');
      
      const result = await dlRenewalService.submitDLRenewalOTP(browser, context, page, otpCode, serviceType);
      let slipPath, appNo;
      if (typeof result === 'object' && result !== null) {
        slipPath = result.screenshotPath;
        appNo = result.appNo;
      } else {
        slipPath = result;
      }

      if (slipPath) {
        await sendImageFile(transport, chatId, slipPath, `DL ${formattedServiceName} completed successfully. Here is your acknowledgement slip.`);
        cleanup(slipPath);
      }

      if (appNo && appNo !== 'Unknown' && payload.dob) {
        try {
          const { getFormset } = require('../../../src/services/formsetService');
          const { buffer, filename, caption } = await getFormset(appNo, payload.dob);
          if (transport === 'telegram') await chatNotifier.sendTelegramDocument(chatId, buffer, filename, caption, 'application/pdf');
          else await chatNotifier.sendWhatsAppMedia(chatId, buffer, 'application/pdf', filename, caption);
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
      const msg = `OTP has been sent to mobile number ${maskedMobile || '******'} for the DL application.\n\nPlease reply with the 6-digit OTP within 5 minutes.`;
      
      const otpCode = await promptAndWaitForInput(transport, chatId, job.id, 'awaiting_otp', msg, is6DigitOtp, 'Invalid OTP format. Please reply with exactly 6 digits.');
      await sendText(transport, chatId, '⏳ OTP received...');
      
      const details = await applyDlService.submitApplyDLOTP(browser, context, page, otpCode);
      const applicationSummary = buildDlApplicationSummary(details);

      if (details.screenshotPath) {
        try {
          await sendImageFile(transport, chatId, details.screenshotPath, applicationSummary);
        } catch (error) {
          logger.error('worker-browser', `Failed to send DL application acknowledgement image: ${error.message}`);
          await sendText(transport, chatId, applicationSummary);
        } finally {
          cleanup(details.screenshotPath);
        }
      } else {
        await sendText(transport, chatId, applicationSummary);
      }

      const appNo = details.appNo || (details.extractedText && details.extractedText.match(/Application No\s*:\s*(\d+)/i)?.[1]);
      if (appNo && appNo !== 'Unknown' && payload.dob) {
        try {
          const { getFormset } = require('../../../src/services/formsetService');
          const { buffer, filename, caption } = await getFormset(appNo, payload.dob);
          if (transport === 'telegram') await chatNotifier.sendTelegramDocument(chatId, buffer, filename, caption, 'application/pdf');
          else await chatNotifier.sendWhatsAppMedia(chatId, buffer, 'application/pdf', filename, caption);
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
      const caption = `Scan this QR code to pay the application fee for Application No: ${payload.appNo}.\n\nAfter payment, reply with "paid" within 5 minutes to receive the receipt.`;
      const userConfirmation = await waitInteractiveInput(
        chatId,
        job.id,
        INTERACTIVE_TIMEOUT_MS,
        async () => {
          await redis.setex(`session:otp:${chatId}`, 300, JSON.stringify({
            jobId: job.id,
            status: 'awaiting_payment_confirmation',
          }));
          try {
            if (transport === 'telegram') await chatNotifier.sendTelegramPhoto(chatId, qrBuffer, 'qr.png', caption);
            else await chatNotifier.sendWhatsAppImage(chatId, qrBuffer, 'qr.png', caption);
          } finally {
            cleanup(qrImagePath);
          }
        }
      );
      if (!/^paid$/i.test(userConfirmation)) {
        throw new Error('Payment confirmation cancelled by user or invalid response.');
      }

      await sendText(transport, chatId, 'Payment confirmed. Preparing your receipt...');
      const receiptPath = await paymentService.confirmPayment(browser, context, page, payload.appNo);
      await sendPdfFile(transport, chatId, receiptPath, `Payment receipt for Application No: ${payload.appNo}.`);
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
      const caption = `Available slots for Application No: ${payload.appNo}.\n\nReply with "auto" for the first available green slot, or send a date such as "29" or "YYYY-MM-DD 13:00" within 5 minutes.`;
      const choice = await waitInteractiveInput(
        chatId,
        job.id,
        INTERACTIVE_TIMEOUT_MS,
        async () => {
          await redis.setex(`session:otp:${chatId}`, 300, JSON.stringify({
            jobId: job.id,
            status: 'awaiting_slot_selection',
          }));
          try {
            if (transport === 'telegram') await chatNotifier.sendTelegramPhoto(chatId, calendarBuffer, 'calendar.png', caption);
            else await chatNotifier.sendWhatsAppImage(chatId, calendarBuffer, 'calendar.png', caption);
          } finally {
            cleanup(calendarScreenshotPath);
          }
        }
      );

      await sendText(transport, chatId, 'Slot selected. Sending the booking OTP...');
      if (/^auto$/i.test(choice)) {
        await slotBookingService.bookPreferredSlot(context, page, null, null);
      } else {
        await slotBookingService.bookPreferredSlot(context, page, choice, null);
      }

      const otpCode = await promptAndWaitForInput(
        transport,
        chatId,
        job.id,
        'awaiting_booking_otp',
        'Booking OTP has been sent. Please reply with the OTP within 5 minutes.',
        is6DigitOtp,
        'Invalid OTP format. Please reply with exactly 6 digits.'
      );
      await sendText(transport, chatId, 'OTP received. Completing slot booking...');
      
      const docPath = await slotBookingService.confirmSlotBookingOTP(browser, context, page, otpCode);
      await sendPdfFile(transport, chatId, docPath, 'Slot booked successfully. Here is your booking confirmation slip.');
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
      
      const aadhaar = await promptAndWaitForInput(
        transport,
        chatId,
        job.id,
        'awaiting_aadhaar',
        'Send your 12-digit Aadhaar number.'
      );
      if (aadhaar.length !== 12 || !/^\d+$/.test(aadhaar)) {
        throw new Error('Invalid Aadhaar number format.');
      }

      await mobileUpdateService.generateAadhaarOtp(page, aadhaar);

      const aadhaarOtp = await promptAndWaitForInput(
        transport,
        chatId,
        job.id,
        'awaiting_aadhaar_otp',
        'Enter the Aadhaar OTP within 5 minutes.',
        is6DigitOtp,
        'Invalid OTP format. Please reply with exactly 6 digits.'
      );
      await mobileUpdateService.authenticateAadhaar(page, aadhaarOtp);

      const newMobile = await promptAndWaitForInput(
        transport,
        chatId,
        job.id,
        'awaiting_new_mobile',
        'Aadhaar verified. Please send the new 10-digit mobile number.'
      );
      if (newMobile.length !== 10 || !/^\d+$/.test(newMobile)) {
        throw new Error('Invalid mobile number format.');
      }

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

      const mobileOtp = await promptAndWaitForInput(
        transport,
        chatId,
        job.id,
        'awaiting_mobile_otp',
        'Enter the mobile OTP within 5 minutes.',
        is6DigitOtp,
        'Invalid OTP format. Please reply with exactly 6 digits.'
      );
      
      const result = await mobileUpdateService.executeBypassScript(page, newMobile, mobileOtp);
      const successMessage = `Mobile number updated successfully to ${newMobile}.`;
      if (result.screenshotPath && result.success) {
        try {
          await sendImageFile(transport, chatId, result.screenshotPath, successMessage);
        } finally {
          cleanup(result.screenshotPath);
        }
      } else if (result.success) {
        await sendText(transport, chatId, successMessage);
      } else if (result.screenshotPath) {
        cleanup(result.screenshotPath);
        throw new Error('Mobile update failed on portal.');
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
  const connection = redisConfig.createRedisClient();
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
        const billing = getBillingInfo(job);
        const cost = billing.creditCost || rateLimiter.getCreditCost(job.command);
        let deducted = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            if (billing.creditReserved) {
              await authRepo.finalizeReservedCreditsForJob(job.user_id, cost, `Heavy job completion: ${job.command}`, job.id);
            } else {
              await authRepo.deductCreditsAudited(job.user_id, cost, `Heavy job completion: ${job.command}`, job.id);
            }
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
      const maxAttempts = Number(bullJob.opts.attempts || 1);
      const isNonRetryable = userFacingErrors.isNonRetryableError(error);
      const isFinalAttempt = isNonRetryable || bullJob.attemptsMade + 1 >= maxAttempts;
      logger.error('worker-browser', `Job ${job.id} failed: ${errMsg}`);

      if (!isFinalAttempt) {
        logger.warn('worker-browser', `Job ${job.id} will retry`, {
          attempt: bullJob.attemptsMade + 1,
          maxAttempts,
        });
        throw error;
      }

      if (rateLimiter.isHeavyCommand(job.command) && job.user_id) {
        const billing = getBillingInfo(job);
        if (billing.creditReserved && billing.creditCost > 0) {
          await authRepo.releaseReservedCreditsForJob(job.user_id, billing.creditCost, job.id).catch((releaseErr) => {
            logger.error('worker-browser', `Failed to release reserved credits for failed job ${job.id}`, { error: releaseErr.message });
          });
        }
      }
      await jobRepository.updateJobStatus(job.id, 'failed', '{}', errMsg);

      const transport = job.transport || 'whatsapp';
      const payload = JSON.parse(job.payload_json || '{}');
      const chatId = job.chat_id || payload.chatId;
      if (chatId) {
        await sendText(transport, chatId, userFacingErrors.getSafeJobFailureMessage(error)).catch((notifyErr) => {
          logger.error('worker-browser', `Failed to notify user about stopped job ${job.id}`, { error: notifyErr.message });
        });
      }

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
