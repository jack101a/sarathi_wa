const { normalizeDob } = require('./commandInputService');

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

const LL_MENU = `Choose a Learner Licence service:
1. LL Print
2. LL Edit
3. Resend LL Password
4. Apply New DL

Reply with a number (1-4) to proceed.`;

const APP_MENU = `Choose an Application service:
1. Acknowledgement Receipt
2. Slot Booking Receipt
3. Form 1 (Self Declaration)
4. Form 1A (Medical Certificate)
5. Form 2
6. Formset (Combined PDF)
7. Print Fee Receipt
8. LL Print
9. Track Application Status

Reply with a number (1-9) to proceed.`;

function detectAndHandle(chatId, normalizedBody) {
  const text = String(normalizedBody || '').trim().replace(/\s+/g, ' ');
  if (!text) {
    return { handled: false };
  }

  const now = Date.now();
  const session = sessions.get(chatId);

  // 1. Process active session response if present and valid
  if (session && session.expiresAt > now) {
    const choice = parseInt(text, 10);
    if (!isNaN(choice) && choice >= 1) {
      if (session.type === 'dl' && choice <= 5) {
        sessions.delete(chatId);
        const cmds = ['dlinfo', 'dlextract', 'renewal', 'duplicate', 'replacement'];
        const commandText = `${cmds[choice - 1]} ${session.identifier} ${session.dob}`;
        return { handled: true, executeCommand: commandText };
      }
      if (session.type === 'll' && choice <= 4) {
        sessions.delete(chatId);
        const cmds = ['llprint', 'lledit', 'resend', 'dlapp'];
        const commandText = `${cmds[choice - 1]} ${session.identifier} ${session.dob}`;
        return { handled: true, executeCommand: commandText };
      }
      if (session.type === 'app' && choice <= 9) {
        sessions.delete(chatId);
        const cmds = ['app', 'slot', 'form1', 'form1a', 'form2', 'formset', 'fees', 'llprint'];
        if (choice === 9) {
          return { handled: true, executeCommand: `track dl ${session.identifier} ${session.dob}` };
        }
        const commandText = `${cmds[choice - 1]} ${session.identifier} ${session.dob}`;
        return { handled: true, executeCommand: commandText };
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
    if (cmdPrefix === 'dl') {
      const dlNo = parts.slice(1, dobIndex).join('').replace(/[-\s]/g, '').toUpperCase();
      if (dlNo) {
        sessions.set(chatId, {
          type: 'dl',
          identifier: dlNo,
          dob,
          expiresAt: now + 120000,
        });
        return { handled: true, replyText: DL_MENU };
      }
    } else if (cmdPrefix === 'll') {
      const llNo = parts.slice(1, dobIndex).join('').replace(/[-\s]/g, '').toUpperCase();
      if (llNo) {
        sessions.set(chatId, {
          type: 'll',
          identifier: llNo,
          dob,
          expiresAt: now + 120000,
        });
        return { handled: true, replyText: LL_MENU };
      }
    } else {
      // Check if the part before the DOB is a numeric application number (8 to 15 digits)
      // Must not contain letters or other command-like text before the DOB
      const preDobText = parts.slice(0, dobIndex).join('');
      if (/^[0-9\s\-/]+$/.test(preDobText)) {
        const appNo = preDobText.replace(/\D/g, '');
        if (appNo && appNo.length >= 8 && appNo.length <= 15) {
          sessions.set(chatId, {
            type: 'app',
            identifier: appNo,
            dob,
            expiresAt: now + 120000,
          });
          return { handled: true, replyText: APP_MENU };
        }
      }
    }
  }

  return { handled: false };
}

module.exports = {
  detectAndHandle,
};
