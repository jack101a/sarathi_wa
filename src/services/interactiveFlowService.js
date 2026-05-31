const { normalizeDob } = require('./commandInputService');
const { query } = require('../core/db');

const sessions = new Map();

const COMMAND_KEYWORDS = new Set([
  'help', 'मदद', 'maddad', 'hi', 'hello',
  'alive', 'suno', 'stop',
  'track', 'listtrack', 'trackrc', 'addtrackrc', 'removetrackrc', 'trackdl', 'addtrack', 'removetrack',
  'form1', 'form1a', 'form2', 'appl', 'app', 'formset', 'feeprint', 'fees', 'llprint', 'lledit',
  'resend', 'payfee', 'bookslot', 'dlrenewal', 'renewal', 'duplicate', 'replacement', 'dlextract',
  'dlapp', 'applydl', 'dlinfo', 'slot'
]);

// Automatic cleanup of expired sessions every 30 seconds
setInterval(() => {
  const now = Date.now();
  for (const [chatId, session] of sessions.entries()) {
    if (session.expiresAt < now) {
      sessions.delete(chatId);
    }
  }
}, 30000);

const DL_MENU = `Choose a Driving Licence service:
1. DL Info
2. DL Extract
3. DL Renewal
4. Duplicate DL
5. DL Replacement

Reply with a number (1-5) to proceed.`;

const APP_MENU_ITEMS = [
  { cmd: 'track', label: 'Track Application Status', group: 1 },
  { cmd: 'app', label: 'Acknowledgement Receipt', group: 2 },
  { cmd: 'form1', label: 'Form 1 (Self Declaration)', group: 2 },
  { cmd: 'form1a', label: 'Form 1A (Medical Certificate)', group: 2 },
  { cmd: 'form2', label: 'Form 2', group: 2 },
  { cmd: 'formset', label: 'Formset (Combined PDF)', group: 2 },
  { cmd: 'fees', label: 'Print Fee Receipt', group: 3 },
  { cmd: 'slot', label: 'Slot Booking Receipt', group: 3 },
  { cmd: 'llprint', label: 'LL Print', group: 4 },
  { cmd: 'resend', label: 'Resend LL Password', group: 4 }
];

const LL_MENU_ITEMS = [
  { cmd: 'lledit', label: 'LL Edit', group: 1 },
  { cmd: 'dlapp', label: 'Apply New DL', group: 2 }
];

const cmdMap = {
  track: 'track',
  app: 'appl_pdf',
  form1: 'form1',
  form1a: 'form1a',
  form2: 'form2',
  formset: 'formset',
  fees: 'fee_print_start',
  slot: 'slot_pdf',
  llprint: 'llprint_start',
  resend: 'resend_otp',
  lledit: 'lledit_start',
  dlapp: 'apply_dl_start'
};

async function detectAndHandle(chatId, normalizedBody, dbUser, isAdmin) {
  const text = String(normalizedBody || '').trim().replace(/\s+/g, ' ');
  if (!text) {
    return { handled: false };
  }

  const now = Date.now();
  const session = sessions.get(chatId);

  // 1. Process active session response if present and valid
  if (session && session.expiresAt > now) {
    const rawChoices = text.split(/[\s,+/]+/).map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    if (rawChoices.length > 0) {
      const isMulti = rawChoices.length > 1;
      const isAllowedMulti = !!(session.isPremium || session.isAdmin);

      if (session.type === 'dl') {
        const choice = rawChoices[0];
        if (choice >= 1 && choice <= 5) {
          sessions.delete(chatId);
          const cmds = ['dlinfo', 'dlextract', 'renewal', 'duplicate', 'replacement'];
          const commandText = `${cmds[choice - 1]} ${session.identifier} ${session.dob}`;
          return { handled: true, executeCommand: commandText };
        }
      }
      
      if (session.type === 'll') {
        const choice = rawChoices[0];
        if (session.presentedCommands && choice >= 1 && choice <= session.presentedCommands.length) {
          sessions.delete(chatId);
          const cmdSelected = session.presentedCommands[choice - 1];
          const commandText = `${cmdSelected} ${session.identifier} ${session.dob}`;
          return { handled: true, executeCommand: commandText };
        }
      }
      
      if (session.type === 'app') {
        if (isMulti && !isAllowedMulti) {
          sessions.delete(chatId);
          return { handled: true, replyText: '🚫 Multiple option selection is only available for Premium plan users.' };
        }

        if (session.presentedCommands) {
          const validChoices = rawChoices.filter(choice => choice >= 1 && choice <= session.presentedCommands.length);
          if (validChoices.length === 0) {
            sessions.delete(chatId);
            return { handled: false };
          }

          sessions.delete(chatId);
          const executeCommands = [];
          for (const choice of validChoices) {
            const cmdSelected = session.presentedCommands[choice - 1];
            if (cmdSelected === 'track') {
              executeCommands.push(`track dl ${session.identifier} ${session.dob}`);
            } else {
              executeCommands.push(`${cmdSelected} ${session.identifier} ${session.dob}`);
            }
          }
          return { handled: true, executeCommands };
        }
      }
    }
    // If not a valid choice, we delete the session and fall through,
    // so any standard typed command works immediately.
    sessions.delete(chatId);
  }

  const parts = text.split(' ');
  const cmdPrefix = parts[0].toLowerCase();

  // Bypass interactive flow if message starts with a direct command keyword
  if (COMMAND_KEYWORDS.has(cmdPrefix)) {
    return { handled: false };
  }

  // Bypass if first word is 'dl' or 'll' and the second word is a specific DL/LL action command
  if ((cmdPrefix === 'dl' || cmdPrefix === 'll') && parts[1]) {
    const secondWord = parts[1].toLowerCase();
    if (['renewal', 'extract', 'info', 'duplicate', 'replacement', 'print', 'edit', 'app', 'dlapp', 'apply'].includes(secondWord)) {
      return { handled: false };
    }
  }

  // Find if any part of the message is a valid DOB
  let dob = '';
  let dobIndex = -1;
  for (let i = 0; i < parts.length; i++) {
    const norm = normalizeDob(parts[i]);
    if (norm) {
      dob = norm;
      dobIndex = i;
      break;
    }
  }

  if (dobIndex !== -1) {
    // Resolve dynamic permissions using subscription plan + rate limit overrides
    let planServices = [];
    if (dbUser) {
      const planId = dbUser.subscription_plan || 'free';
      try {
        const planRows = await query('SELECT services_json FROM subscription_plans WHERE id = ?', [planId]);
        if (planRows && planRows[0]) {
          planServices = JSON.parse(planRows[0].services_json || '[]');
        }
      } catch (_) {}
    }

    let userServices = null;
    if (dbUser && dbUser.rate_limit_overrides) {
      try {
        const overrides = JSON.parse(dbUser.rate_limit_overrides || '{}');
        if (Array.isArray(overrides.services)) {
          userServices = overrides.services;
        }
      } catch (_) {}
    }

    const allowed = userServices || planServices;
    const isAllowed = (serviceId) => {
      if (isAdmin) return true;
      if (!allowed || allowed.length === 0) return false;
      return allowed.includes('*') || allowed.includes(serviceId);
    };

    const isPremium = !!(dbUser && dbUser.subscription_plan === 'premium');

    if (cmdPrefix === 'dl') {
      const dlNo = parts.slice(1, dobIndex).join('').replace(/[-\s]/g, '').toUpperCase();
      if (dlNo) {
        sessions.set(chatId, {
          type: 'dl',
          identifier: dlNo,
          dob,
          expiresAt: now + 120000,
          isAdmin: !!isAdmin,
          isPremium,
        });
        return { handled: true, replyText: DL_MENU };
      }
    } else if (cmdPrefix === 'll') {
      const llNo = parts.slice(1, dobIndex).join('').replace(/[-\s]/g, '').toUpperCase();
      if (llNo) {
        // Filter LL menu items dynamically based on permissions
        const allowedLlItems = LL_MENU_ITEMS.filter(item => isAllowed(cmdMap[item.cmd]));
        if (allowedLlItems.length === 0) {
          return { handled: false };
        }

        let llMenuText = `Choose a Learner Licence service:\n`;
        let currentGroup = 1;
        let idx = 1;
        const presentedLlCommands = [];

        for (const item of allowedLlItems) {
          if (item.group !== currentGroup) {
            llMenuText += `\n`;
            currentGroup = item.group;
          }
          llMenuText += `${idx++}. ${item.label}\n`;
          presentedLlCommands.push(item.cmd);
        }
        llMenuText += `\nReply with a number (1-${idx - 1}) to proceed.`;

        sessions.set(chatId, {
          type: 'll',
          identifier: llNo,
          dob,
          expiresAt: now + 120000,
          isAdmin: !!isAdmin,
          isPremium,
          presentedCommands: presentedLlCommands,
        });
        return { handled: true, replyText: llMenuText };
      }
    } else {
      // Check if the part before the DOB is a numeric application number (8 to 15 digits)
      // Must not contain letters or other command-like text before the DOB
      const preDobText = parts.slice(0, dobIndex).join('');
      if (/^[0-9\s\-/]+$/.test(preDobText)) {
        const appNo = preDobText.replace(/\D/g, '');
        if (appNo && appNo.length >= 8 && appNo.length <= 15) {
          // Filter APP menu items dynamically based on permissions
          const allowedAppItems = APP_MENU_ITEMS.filter(item => isAllowed(cmdMap[item.cmd]));
          if (allowedAppItems.length === 0) {
            return { handled: false };
          }

          let appMenuText = `Choose an Application service:\n`;
          let currentGroup = 1;
          let idx = 1;
          const presentedAppCommands = [];

          for (const item of allowedAppItems) {
            if (item.group !== currentGroup) {
              appMenuText += `\n`;
              currentGroup = item.group;
            }
            appMenuText += `${idx++}. ${item.label}\n`;
            presentedAppCommands.push(item.cmd);
          }
          appMenuText += `\nReply with a number (1-${idx - 1}) to proceed.`;

          sessions.set(chatId, {
            type: 'app',
            identifier: appNo,
            dob,
            expiresAt: now + 120000,
            isAdmin: !!isAdmin,
            isPremium,
            presentedCommands: presentedAppCommands,
          });
          return { handled: true, replyText: appMenuText };
        }
      }
    }
  }

  return { handled: false };
}

module.exports = {
  detectAndHandle,
};
