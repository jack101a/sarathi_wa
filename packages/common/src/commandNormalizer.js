const { normalizeDob } = require('./commandInputService');
const { query } = require('./db');

function isDlInput(appNo) {
  const cleaned = String(appNo || '').trim().replace(/[-\s]/g, '');
  if (!cleaned) return false;
  // Purely numeric (DL application number, usually 10 digits)
  if (/^\d+$/.test(cleaned)) return true;
  // DL license number: starts with 2 letters, followed ONLY by digits, length >= 15
  if (/^[A-Za-z]{2}\d+$/.test(cleaned) && cleaned.length >= 15) return true;
  return false;
}

// Simple Hindi/Hinglish Error templates
const ERRORS = {
  MISSING_DOB: (cmd) => `❌ *जन्मतिथि (DOB) नहीं मिली!*\nलाइसेंस की जानकारी के लिए जन्मतिथि देना ज़रूरी है।\n\n*सही तरीका (Format):*\n👉 \`${cmd} <appl_no> <DOB>\`\n\n*उदाहरण (Example):*\n👉 \`${cmd} 2982778275 01-02-2003\`\n(जन्मतिथि को हमेशा DD-MM-YYYY फॉर्मेट में लिखें, जैसे: 01-02-2003)`,
  
  INVALID_DOB: `❌ *गलत जन्मतिथि (DOB) फॉर्मेट!*\nजन्मतिथि का फॉर्मेट सही नहीं है।\n\n*सही तरीका (Format):*\n👉 जन्मतिथि को हमेशा DD-MM-YYYY फॉर्मेट में लिखें (जैसे: 01-02-2003)`,
  
  MISSING_QUALIFIER: `❌ *कृपया DL या RC कमांड का उपयोग करें!*\nअब केवल \`track\` लिखने से काम नहीं चलेगा। आपको स्पष्ट बताना होगा कि आप DL देखना चाहते हैं या RC।\n\n*सही तरीका (Format):*\n👉 *DL के लिए:* \`track DL <appl_no> <DOB>\`\n👉 *RC के लिए:* \`track RC <appl_no>\`\n\n*उदाहरण (Example):*\n👉 \`track DL 2982778275 01-02-2003\`\n👉 \`track RC MH26021234567\``,
  
  MISSING_APP_NO: (cmd, requiresDob = false) => `❌ *आवेदन संख्या (Application Number) नहीं मिली!*\n\n*सही तरीका (Format):*\n👉 \`${cmd} <appl_no>${requiresDob ? ' <DOB>' : ''}\``
};

const USER_HELP_TEXT = `==========================
           ***   *🤖 Bot Help*   ***
==========================

*# Application related services #*

> Type the appl no. and DOB:

*2982778275  01-02-2003*
........................................................

*# DL related services #*

> Type DL no and DOB :

*DL MH4720100001234 01-02-2003*
........................................................

*# LL related services #*

> Type LL and DOB :

*LL MH47/0050138/2026 01-02-2003*
........................................................

> 📲 Update Mobile Number 

*mobupdate MH4720100001234 01-02-2003*
........................................................

> Resend Password 

*resend 2982778275 01-02-2003*
........................................................

==========================
*# Tracking Services#*

> Save DL for auto tracking:

*track add 2982778275 01-02-2003*

> Track RC status instantly:

*track RC MH260201515412312*

> View all saved tracks status:

*track status*
==========================

-----------------------------------------
> *⚙️ More*

*balance* : to check available balance

*stop* : stop current running task
-----------------------------------------`;

const ADMIN_HELP_TEXT = `${USER_HELP_TEXT}

*👑 Admin extras / एडमिन सुविधाएं*
payfee appl_no dob
bookslot appl_no dob
alive`;

function parseCommand(rawText, hasMedia, user, isAdmin) {
  if (hasMedia) {
    return { success: false, ignore: true };
  }

  const cleanedText = String(rawText || '')
    .trim()
    .replace(/\s+/g, ' ');

  if (!cleanedText) {
    return { success: false, ignore: true };
  }

  // Intercept multiple tracking command:
  // e.g. "track dl 842305226, 842513926, ..." or "track 842305226, 842513926, ..."
  // Must match words containing digits only, separated by commas or spaces, with no valid DOB present.
  const isTrackCommand = /^(?:track\s+)?(?:dl\s+)?/i.test(cleanedText);
  if (isTrackCommand) {
    const tokens = cleanedText.split(/[\s,+/]+/);
    const hasDob = tokens.some(t => normalizeDob(t));
    if (!hasDob) {
      const appNos = tokens.filter(t => /^\d{8,15}$/.test(t));
      if (appNos.length > 1) {
        if (!isAdmin && (!user || user.subscription_plan !== 'premium')) {
          return { success: false, error: '🚫 Multiple application tracking is only available for Premium plan users.' };
        }
        return { success: true, type: 'track_multiple', payload: { appNos } };
      }
    }
  }

  // Check for admin commands silent block
  const isAuthCommand = /^(?:\/)?auth\b/i.test(cleanedText);
  const isRefreshCommand = /^(?:\/)?refreshtrack\b/i.test(cleanedText) || /^refresh\s+track$/i.test(cleanedText) || /^track\s+refresh$/i.test(cleanedText);

  if (isAuthCommand || isRefreshCommand) {
    // Admin check removed, access managed via plans
  }

  // Strip leading slash if present
  let textToParse = cleanedText;
  if (textToParse.startsWith('/')) {
    textToParse = textToParse.slice(1);
  }

  // Normalize user account and billing commands
  textToParse = textToParse
    .replace(/^bal\b/i, 'balance')
    .replace(/^txn\b/i, 'history')
    .replace(/^txns\b/i, 'history')
    .replace(/^transactions\b/i, 'history');

  // Normalize multi-word phrases to their single-word equivalents
  textToParse = textToParse
    .replace(/^add\s+track\s+rc\b/i, 'addtrackrc')
    .replace(/^remove\s+track\s+rc\b/i, 'removetrackrc')
    .replace(/^add\s+track\b/i, 'addtrack')
    .replace(/^remove\s+track\b/i, 'removetrack')
    .replace(/^track\s+rc\b/i, 'trackrc')
    .replace(/^track\s+dl\b/i, 'trackdl')
    .replace(/^list\s+track\b/i, 'listtrack')
    .replace(/^dl\s+renewal\b/i, 'dlrenewal')
    .replace(/^dl\s+extract\b/i, 'dlextract')
    .replace(/^dl\s+info\b/i, 'dlinfo')
    .replace(/^dl\s+duplicate\b/i, 'duplicate')
    .replace(/^dl\s+replacement\b/i, 'replacement')
    .replace(/^apply\s+dl\b/i, 'dlapp')
    .replace(/^book\s+slot\b/i, 'bookslot')
    .replace(/^pay\s+fee\b/i, 'payfee')
    .replace(/^fee\s+print\b/i, 'feeprint')
    .replace(/^print\s+fee\b/i, 'feeprint')
    .replace(/^ll\s+print\b/i, 'llprint')
    .replace(/^ll\s+edit\b/i, 'lledit')
    .replace(/^mob\s+update\b/i, 'mobupdate')
    .replace(/^mobupdate\b/i, 'mobupdate');

  const parts = textToParse.split(' ');
  let cmd = parts[0].toLowerCase();

  // Friendly short aliases advertised in help.
  if (cmd === 'dl') {
    textToParse = `dlinfo ${parts.slice(1).join(' ')}`.trim();
  } else if (cmd === 'll') {
    textToParse = `dlapp ${parts.slice(1).join(' ')}`.trim();
  }
  if (cmd === 'dl' || cmd === 'll') {
    parts.splice(0, parts.length, ...textToParse.split(' '));
    cmd = parts[0].toLowerCase();
  }

  // Shortest DL application status form: "<appl_no> <dob>".
  if (/^\d{8,15}$/.test(cmd) && parts[1]) {
    const normalizedDob = normalizeDob(parts[1]);
    if (normalizedDob) {
      return { success: true, type: 'track', payload: { appNo: cmd, dob: normalizedDob } };
    }
  }

  // Pre-process and merge split DL number parts (e.g. "MH47 20150008844")
  if (['dlrenewal', 'renewal', 'duplicate', 'replacement', 'dlextract', 'dlinfo', 'mobupdate'].includes(cmd)) {
    if (parts[1] && parts[2]) {
      const p1Clean = parts[1].replace(/[-\s]/g, '').toUpperCase();
      const p2Clean = parts[2].replace(/[-\s]/g, '').toUpperCase();
      if (/^[A-Z]{2}\d{2}$/.test(p1Clean) && /^\d+$/.test(p2Clean)) {
        parts[1] = p1Clean + p2Clean;
        parts.splice(2, 1); // remove the merged part
      }
    }
  }

  // Pre-process and merge split LL number parts (e.g. "MH47 /0050138/2026")
  if (cmd === 'dlapp') {
    if (parts[1] && parts[2]) {
      const p1Clean = parts[1].replace(/[-\s]/g, '').toUpperCase();
      if (/^[A-Z]{2}\d{2}$/.test(p1Clean) && parts[2].startsWith('/')) {
        parts[1] = p1Clean + parts[2];
        parts.splice(2, 1); // remove the merged part
      }
    }
  }

  // 1. HELP COMMANDS
  if (/^(?:help|मदद|maddad|hi|hello)$/i.test(cmd)) {
    return { success: true, type: 'help', message: isAdmin ? ADMIN_HELP_TEXT : USER_HELP_TEXT };
  }

  // 1.1 USER ACCOUNT / BILLING COMMANDS
  if (cmd === 'balance') {
    return { success: true, type: 'balance', payload: {} };
  }
  if (cmd === 'history') {
    return { success: true, type: 'history', payload: {} };
  }
  if (cmd === 'plan') {
    return { success: true, type: 'plan', payload: {} };
  }
  if (cmd === 'topup') {
    const amount = parts[1] ? parseInt(parts[1], 10) : undefined;
    return {
      success: true,
      type: 'topup',
      payload: { amount: Number.isFinite(amount) ? amount : undefined },
    };
  }
  if (cmd === 'paid') {
    return {
      success: false,
      error: '❌ Manual UPI/UTR wallet top-up is disabled.\nPlease send `topup 100` or `topup 500` to generate a Razorpay QR code.',
    };
  }

  // 2. ALIVE/SUNO
  if (/^(?:alive|suno)$/i.test(cmd)) {
    return { success: true, type: 'alive' };
  }

  // 3. STOP
  if (/^(?:stop)$/i.test(cmd)) {
    return { success: true, type: 'stop' };
  }

  // 4. ADMIN REFRESH TRACK (already verified isAdmin above)
  if (isRefreshCommand) {
    return { success: true, type: 'refresh_track', payload: {} };
  }

  // 5. TRACK COMMANDS
  if (cmd === 'track') {
    const sub = (parts[1] || '').toLowerCase();
    
    // track status
    if (sub === 'status') {
      return { success: true, type: 'track_status', payload: {} };
    }

    // track add
    if (sub === 'add') {
      let appNo = parts[2] || '';
      let rawDob = '';
      let isExplicitRc = false;
      let isExplicitDl = false;

      if (appNo.toLowerCase() === 'dl') {
        isExplicitDl = true;
        appNo = parts[3] || '';
        rawDob = parts[4] || '';
      } else if (appNo.toLowerCase() === 'rc') {
        const nextArg = parts[3] || '';
        if (isDlInput(nextArg)) {
          isExplicitDl = true;
          appNo = nextArg;
          rawDob = parts[4] || '';
        } else {
          isExplicitRc = true;
          appNo = nextArg;
        }
      } else {
        rawDob = parts[3] || '';
      }

      if (!appNo) {
        return { success: false, error: ERRORS.MISSING_APP_NO('track add', !isExplicitRc) };
      }

      const isRc = isExplicitRc || (!isExplicitDl && !isDlInput(appNo) && /^[A-Z0-9]{8,22}$/i.test(appNo) && /[A-Z]/i.test(appNo));
      if (isRc) {
        return { success: true, type: 'add_track_rc', payload: { appNo: appNo.toUpperCase(), tag: '' } };
      } else {
        // DL track add requires DOB
        if (!rawDob) {
          return { success: false, error: ERRORS.MISSING_DOB('track add') };
        }
        const normalizedDob = rawDob ? normalizeDob(rawDob) : '';
        if (!normalizedDob) {
          return { success: false, error: ERRORS.INVALID_DOB };
        }
        return { success: true, type: 'add_track', payload: { appNo, dob: normalizedDob, tag: '' } };
      }
    }

    // track remove
    if (sub === 'remove') {
      let appNo = parts[2] || '';
      if (appNo.toLowerCase() === 'dl' || appNo.toLowerCase() === 'rc') {
        appNo = parts[3] || '';
      }
      if (!appNo) {
        return { success: false, error: ERRORS.MISSING_APP_NO('track remove') };
      }
      const isRc = !isDlInput(appNo) && /^[A-Z0-9]{8,22}$/i.test(appNo) && /[A-Z]/i.test(appNo);
      if (isRc) {
        return { success: true, type: 'remove_track_rc', payload: { appNo: appNo.toUpperCase() } };
      } else {
        return { success: true, type: 'remove_track', payload: { appNo } };
      }
    }

    // track DL
    if (sub === 'dl') {
      const appNo = parts[2] || '';
      if (!appNo) {
        return { success: false, error: ERRORS.MISSING_APP_NO('track DL', true) };
      }
      const rawDob = parts[3] || '';
      if (!rawDob) {
        return { success: false, error: ERRORS.MISSING_DOB('track DL') };
      }
      const normalizedDob = rawDob ? normalizeDob(rawDob) : '';
      if (!normalizedDob) {
        return { success: false, error: ERRORS.INVALID_DOB };
      }
      return { success: true, type: 'track', payload: { appNo, dob: normalizedDob } };
    }

    // track RC
    if (sub === 'rc') {
      const appNo = parts[2] || '';
      if (!appNo) {
        return { success: false, error: ERRORS.MISSING_APP_NO('track RC') };
      }
      if (isDlInput(appNo)) {
        const rawDob = parts[3] || '';
        if (!rawDob) {
          return { success: false, error: ERRORS.MISSING_DOB('track DL') };
        }
        const normalizedDob = normalizeDob(rawDob);
        if (!normalizedDob) {
          return { success: false, error: ERRORS.INVALID_DOB };
        }
        return { success: true, type: 'track', payload: { appNo, dob: normalizedDob } };
      }
      return { success: true, type: 'track_rc', payload: { appNo: appNo.toUpperCase() } };
    }

    if (sub) {
      if (isDlInput(sub)) {
        const rawDob = parts[2] || '';
        if (!rawDob) {
          return { success: false, error: ERRORS.MISSING_DOB('track DL') };
        }
        const normalizedDob = rawDob ? normalizeDob(rawDob) : '';
        if (!normalizedDob) {
          return { success: false, error: ERRORS.INVALID_DOB };
        }
        return { success: true, type: 'track', payload: { appNo: sub, dob: normalizedDob } };
      } else {
        const isRc = /^[A-Z0-9]{8,22}$/i.test(sub) && /[A-Z]/i.test(sub);
        if (isRc) {
          return { success: true, type: 'track_rc', payload: { appNo: sub.toUpperCase() } };
        }
      }
    }

    // fallback: plain "track" command or invalid qualifier
    return { success: false, error: ERRORS.MISSING_QUALIFIER };
  }

  // 6. SHORTCUT / INDEPENDENT COMMANDS
  if (/^(?:listtrack|list\s+track)$/i.test(textToParse)) {
    return { success: true, type: 'track_status', payload: {} };
  }

  if (cmd === 'trackrc') {
    const appNo = parts[1] || '';
    if (!appNo) return { success: false, error: ERRORS.MISSING_APP_NO('track RC') };
    if (isDlInput(appNo)) {
      const rawDob = parts[2] || '';
      if (!rawDob) return { success: false, error: ERRORS.MISSING_DOB('track DL') };
      const normalizedDob = normalizeDob(rawDob);
      if (!normalizedDob) return { success: false, error: ERRORS.INVALID_DOB };
      return { success: true, type: 'track', payload: { appNo, dob: normalizedDob } };
    }
    return { success: true, type: 'track_rc', payload: { appNo: appNo.toUpperCase() } };
  }
  if (cmd === 'addtrackrc') {
    const appNo = parts[1] || '';
    if (!appNo) return { success: false, error: ERRORS.MISSING_APP_NO('track add') };
    if (isDlInput(appNo)) {
      const rawDob = parts[2] || '';
      if (!rawDob) return { success: false, error: ERRORS.MISSING_DOB('track add') };
      const normalizedDob = normalizeDob(rawDob);
      if (!normalizedDob) return { success: false, error: ERRORS.INVALID_DOB };
      return { success: true, type: 'add_track', payload: { appNo, dob: normalizedDob, tag: '' } };
    }
    return { success: true, type: 'add_track_rc', payload: { appNo: appNo.toUpperCase(), tag: '' } };
  }
  if (cmd === 'removetrackrc') {
    const appNo = parts[1] || '';
    if (!appNo) return { success: false, error: ERRORS.MISSING_APP_NO('track remove') };
    if (isDlInput(appNo)) {
      return { success: true, type: 'remove_track', payload: { appNo } };
    }
    return { success: true, type: 'remove_track_rc', payload: { appNo: appNo.toUpperCase() } };
  }

  if (cmd === 'trackdl') {
    const appNo = parts[1] || '';
    if (!appNo) return { success: false, error: ERRORS.MISSING_APP_NO('track DL', true) };
    const rawDob = parts[2] || '';
    if (!rawDob) return { success: false, error: ERRORS.MISSING_DOB('track DL') };
    const normalizedDob = rawDob ? normalizeDob(rawDob) : '';
    if (!normalizedDob) return { success: false, error: ERRORS.INVALID_DOB };
    return { success: true, type: 'track', payload: { appNo, dob: normalizedDob } };
  }
  if (cmd === 'addtrack') {
    let appNo = parts[1] || '';
    let rawDob = '';
    let isExplicitRc = false;
    let isExplicitDl = false;

    if (appNo.toLowerCase() === 'dl') {
      isExplicitDl = true;
      appNo = parts[2] || '';
      rawDob = parts[3] || '';
    } else if (appNo.toLowerCase() === 'rc') {
      const nextArg = parts[2] || '';
      if (isDlInput(nextArg)) {
        isExplicitDl = true;
        appNo = nextArg;
        rawDob = parts[3] || '';
      } else {
        isExplicitRc = true;
        appNo = nextArg;
      }
    } else {
      rawDob = parts[2] || '';
    }

    if (!appNo) return { success: false, error: ERRORS.MISSING_APP_NO('track add', !isExplicitRc) };

    const isRc = isExplicitRc || (!isExplicitDl && !isDlInput(appNo) && /^[A-Z0-9]{8,22}$/i.test(appNo) && /[A-Z]/i.test(appNo));
    if (isRc) {
      return { success: true, type: 'add_track_rc', payload: { appNo: appNo.toUpperCase(), tag: '' } };
    } else {
      if (!rawDob) return { success: false, error: ERRORS.MISSING_DOB('track add') };
      const normalizedDob = rawDob ? normalizeDob(rawDob) : '';
      if (!normalizedDob) return { success: false, error: ERRORS.INVALID_DOB };
      return { success: true, type: 'add_track', payload: { appNo, dob: normalizedDob, tag: '' } };
    }
  }
  if (cmd === 'removetrack') {
    let appNo = parts[1] || '';
    if (appNo.toLowerCase() === 'dl' || appNo.toLowerCase() === 'rc') {
      appNo = parts[2] || '';
    }
    if (!appNo) return { success: false, error: ERRORS.MISSING_APP_NO('track remove') };
    const isRc = !isDlInput(appNo) && /^[A-Z0-9]{8,22}$/i.test(appNo) && /[A-Z]/i.test(appNo);
    if (isRc) {
      return { success: true, type: 'remove_track_rc', payload: { appNo: appNo.toUpperCase() } };
    } else {
      return { success: true, type: 'remove_track', payload: { appNo } };
    }
  }

  // 7. FORM DOWNLOAD COMMANDS
  const FORM_MAP = {
    form1: 'form1',
    form1a: 'form1a',
    form2: 'form2',
    appl: 'appl_pdf',
    app: 'appl_pdf',
    formset: 'formset',
    feeprint: 'fee_print_start',
    fees: 'fee_print_start',
    llprint: 'llprint_start',
    lledit: 'lledit_start',
    resend: 'resend_otp',
    payfee: 'pay_fee_start',
    bookslot: 'slot_booking_start',
    dlrenewal: 'dl_renewal_start',
    renewal: 'dl_renewal_start',
    duplicate: 'dl_renewal_start',
    replacement: 'dl_renewal_start',
    dlextract: 'dl_renewal_start',
    dlapp: 'apply_dl_start',
    dlinfo: 'dl_info_start',
    slot: 'slot_pdf',
    mobupdate: 'mobupdate_start'
  };

  if (FORM_MAP[cmd]) {
    // Admin check removed, access managed via plans
    const appNo = parts[1] || '';
    if (!appNo) {
      return { success: false, error: ERRORS.MISSING_APP_NO(cmd, true) };
    }
    const rawDob = parts[2] || '';
    if (!rawDob) {
      return { success: false, error: ERRORS.MISSING_DOB(cmd) };
    }
    const normalizedDob = rawDob ? normalizeDob(rawDob) : '';
    if (!normalizedDob) {
      return { success: false, error: ERRORS.INVALID_DOB };
    }

    if (cmd === 'dlrenewal' || cmd === 'renewal' || cmd === 'duplicate' || cmd === 'replacement' || cmd === 'dlextract' || cmd === 'dlinfo' || cmd === 'mobupdate') {
      let dlNo = appNo;
      // Clean and format DL number with space after the 4th character (State + RTO) in uppercase
      const cleanedDL = dlNo.replace(/[-\s]/g, '').toUpperCase();
      if (/^[A-Z]{2}\d{2}/.test(cleanedDL)) {
        dlNo = cleanedDL.slice(0, 4) + ' ' + cleanedDL.slice(4);
      }
      const rtoCode = parts[3] && parts[3].length !== 10 && isNaN(Number(parts[3])) ? parts[3] : '';
      let mobile = '';
      if (parts[3] && (parts[3].length === 10 || !isNaN(Number(parts[3])))) {
        mobile = parts[3];
      } else if (parts[4]) {
        mobile = parts[4];
      }
      
      if (cmd === 'mobupdate') {
        return { success: true, type: 'mobupdate_start', payload: { dlNo, dob: normalizedDob, mobile } };
      }

      if (cmd === 'dlinfo') {
        return { success: true, type: 'dl_info_start', payload: { dlNo, dob: normalizedDob } };
      }

      let serviceType = 'RENEWAL OF DL';
      if (cmd === 'duplicate') serviceType = 'ISSUE OF DUPLICATE DL';
      else if (cmd === 'replacement') serviceType = 'REPLACEMENT OF DL';
      else if (cmd === 'dlextract') serviceType = 'DL EXTRACT';

      return { success: true, type: 'dl_renewal_start', payload: { dlNo, dob: normalizedDob, rtoCode, mobile, serviceType } };
    }

    if (cmd === 'dlapp') {
      let llNo = appNo.trim().toUpperCase();
      const llPattern = /^([A-Z]{2}\d{2})[-\s]?\/?(.*)$/;
      const match = llNo.match(llPattern);
      if (match) {
        const prefix = match[1];
        const rest = match[2];
        const cleanRest = rest.startsWith('/') ? rest : '/' + rest;
        llNo = `${prefix} ${cleanRest}`;
      }
      const mobile = parts[3] || '';
      return { success: true, type: 'apply_dl_start', payload: { llNo, dob: normalizedDob, mobile } };
    }

    const mobile = parts[3] || '';
    return { success: true, type: FORM_MAP[cmd], payload: { appNo, dob: normalizedDob, mobile } };
  }

  // No command matched
  return { success: false, unmatched: true };
}

async function generateHelpText(user, isAdmin) {
  const planId = (user && (user.plan_id || user.subscription_plan)) || 'free';
  
  let allowedServices = new Set();
  if (isAdmin) {
    const all = await query('SELECT id FROM services');
    all.forEach(s => allowedServices.add(s.id));
  } else {
    const rows = await query('SELECT service_id FROM plan_services WHERE plan_id = ?', [planId]);
    rows.forEach(r => allowedServices.add(r.service_id));
  }

  const sections = [];
  sections.push('==========================');
  sections.push('           ***   *🤖 Bot Help*   ***');
  sections.push('==========================');
  sections.push('');

  // 1. Application related
  const appServices = ['appl_pdf', 'slot_pdf', 'form1', 'form1a', 'form2', 'formset'];
  if (appServices.some(s => allowedServices.has(s))) {
    sections.push('*# Application related services #*');
    sections.push('');
    sections.push('> Type the appl no. and DOB:');
    sections.push('');
    sections.push('*2982778275  01-02-2003*');
    sections.push('........................................................');
    sections.push('');
  }

  // 2. DL related
  if (allowedServices.has('dl_info_start')) {
    sections.push('*# DL related services #*');
    sections.push('');
    sections.push('> Type DL no and DOB :');
    sections.push('');
    sections.push('*DL MH4720100001234 01-02-2003*');
    sections.push('........................................................');
    sections.push('');
  }

  // 3. LL related
  if (allowedServices.has('apply_dl_start')) {
    sections.push('*# LL related services #*');
    sections.push('');
    sections.push('> Type LL and DOB :');
    sections.push('');
    sections.push('*LL MH47/0050138/2026 01-02-2003*');
    sections.push('........................................................');
    sections.push('');
  }

  // 4. Update Mobile Number
  if (allowedServices.has('mobupdate_start')) {
    sections.push('> 📲 Update Mobile Number ');
    sections.push('');
    sections.push('*mobupdate MH4720100001234 01-02-2003*');
    sections.push('........................................................');
    sections.push('');
  }

  // 5. Resend Password
  if (allowedServices.has('resend_otp')) {
    sections.push('> Resend Password ');
    sections.push('');
    sections.push('*resend 2982778275 01-02-2003*');
    sections.push('........................................................');
    sections.push('');
  }

  // 6. Tracking services
  const trackingLines = [];
  if (allowedServices.has('add_track')) {
    trackingLines.push('> Save DL for auto tracking:');
    trackingLines.push('');
    trackingLines.push('*track add 2982778275 01-02-2003*');
    trackingLines.push('');
  }
  if (allowedServices.has('track_rc') || allowedServices.has('add_track_rc')) {
    trackingLines.push('> Track RC status instantly:');
    trackingLines.push('');
    trackingLines.push('*track RC MH260201515412312*');
    trackingLines.push('');
  }
  if (allowedServices.has('track_status')) {
    trackingLines.push('> View all saved tracks status:');
    trackingLines.push('');
    trackingLines.push('*track status*');
  }

  if (trackingLines.length > 0) {
    sections.push('==========================');
    sections.push('*# Tracking Services#*');
    sections.push('');
    sections.push(trackingLines.join('\n').trim());
    sections.push('==========================');
    sections.push('');
  }

  // 7. More
  sections.push('-----------------------------------------');
  sections.push('> *⚙️ More*');
  sections.push('');
  sections.push('*balance* : to check available balance');
  sections.push('');
  sections.push('*stop* : stop current running task');
  sections.push('-----------------------------------------');

  // 8. Admin extras
  if (isAdmin) {
    const adminLines = [];
    if (allowedServices.has('pay_fee_start')) {
      adminLines.push('payfee appl_no dob');
    }
    if (allowedServices.has('slot_booking_start')) {
      adminLines.push('bookslot appl_no dob');
    }
    if (allowedServices.has('alive')) {
      adminLines.push('alive');
    }

    if (adminLines.length > 0) {
      sections.push('');
      sections.push('*👑 Admin extras / एडमिन सुविधाएं*');
      sections.push(adminLines.join('\n'));
    }
  }

  return sections.join('\n').trim();
}

module.exports = {
  parseCommand,
  generateHelpText,
  USER_HELP_TEXT,
  ADMIN_HELP_TEXT,
  ERRORS
};
