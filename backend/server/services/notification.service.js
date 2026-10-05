const { dbPool, dbNotificationsStore, dbUsersStore } = require('../db');
const { emitRealtimeEvent } = require('../events');

function stripEmojis(str) {
  if (!str) return '';
  return String(str)
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2300}-\u{23FF}\u{2B50}\u{200D}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolves all known ID aliases for a given user identifier, role, email, or name.
 * e.g., Designer can be '5', 5, 'usr_designer_01', 'designer@markops.io', 'DESIGNER'
 */
function resolveUserAliases(userIdentifier, role = '', email = '', name = '') {
  const aliases = new Set(['all']);
  const strId = String(userIdentifier || '').toLowerCase().trim();
  const strRole = String(role || '').toUpperCase().trim();
  const strEmail = String(email || '').toLowerCase().trim();
  const strName = String(name || '').toLowerCase().trim();

  if (strId) aliases.add(strId);
  if (strEmail) aliases.add(strEmail);
  if (strName) aliases.add(strName);

  // Role mappings to known user IDs and email addresses
  const ROLE_ALIASES = {
    ADMINISTRATOR: ['1', 'usr_admin_01', 'admin@markops.io', 'admin', 'administrator', 'system administrator'],
    BDM: ['2', 'usr_bdm_01', 'bdm@markops.io', 'bdm', 'business development manager'],
    MARKETING_MANAGER: ['3', 'usr_mktg_01', 'manager@markops.io', 'manager', 'marketing manager'],
    DIGITAL_MARKETING: ['4', 'usr_digital_01', 'digital@markops.io', 'digital', 'digital marketing', 'digital marketing specialist'],
    DESIGNER: ['5', 'usr_designer_01', 'designer@markops.io', 'designer', 'senior visual designer'],
    TELECALLER: ['6', 'usr_telecaller_01', 'telecaller@markops.io', 'telecaller', 'raj', 'lead telecaller', 'gokul raj'],
  };

  // Determine role if not explicitly provided
  let detectedRole = strRole;
  if (!detectedRole) {
    if (strId === '1' || strId === 'usr_admin_01' || strEmail.includes('admin')) detectedRole = 'ADMINISTRATOR';
    else if (strId === '2' || strId === 'usr_bdm_01' || strEmail.includes('bdm')) detectedRole = 'BDM';
    else if (strId === '3' || strId === 'usr_mktg_01' || strEmail.includes('manager')) detectedRole = 'MARKETING_MANAGER';
    else if (strId === '4' || strId === 'usr_digital_01' || strEmail.includes('digital')) detectedRole = 'DIGITAL_MARKETING';
    else if (strId === '5' || strId === 'usr_designer_01' || strEmail.includes('designer')) detectedRole = 'DESIGNER';
    else if (strId === '6' || strId === 'usr_telecaller_01' || strEmail.includes('telecaller') || strName.includes('raj')) detectedRole = 'TELECALLER';
  }

  if (detectedRole && ROLE_ALIASES[detectedRole]) {
    ROLE_ALIASES[detectedRole].forEach((a) => aliases.add(a));
  }

  // Cross-reference with in-memory users store if present
  if (Array.isArray(dbUsersStore)) {
    const userMatch = dbUsersStore.find(
      (u) =>
        (strId && (String(u.id).toLowerCase() === strId || String(u.id) === strId)) ||
        (strEmail && u.email && u.email.toLowerCase() === strEmail) ||
        (detectedRole && u.role === detectedRole)
    );
    if (userMatch) {
      if (userMatch.id) aliases.add(String(userMatch.id).toLowerCase());
      if (userMatch.email) aliases.add(userMatch.email.toLowerCase());
      if (userMatch.fullName) aliases.add(userMatch.fullName.toLowerCase());
      if (userMatch.role && ROLE_ALIASES[userMatch.role]) {
        ROLE_ALIASES[userMatch.role].forEach((a) => aliases.add(a));
      }
    }
  }

  return aliases;
}

/**
 * Dispatches a notification to one or more user IDs.
 * Persists to MySQL if available, caches in dbNotificationsStore, and broadcasts via Socket.IO.
 */
async function dispatchNotification({ userIds = [], title, message, type = 'INFO', targetRoute = null }) {
  const recipients = new Set();
  const arr = Array.isArray(userIds) ? userIds : [userIds];
  arr.forEach((u) => {
    if (u !== undefined && u !== null && u !== '') {
      recipients.add(u);
    }
  });

  const cleanTitle = stripEmojis(title);
  const cleanMessage = stripEmojis(message);
  const createdNotifs = [];

  for (const rId of recipients) {
    const numericUserId = typeof rId === 'number' ? rId : (parseInt(rId, 10) || null);
    const notifObj = {
      id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      userId: numericUserId || String(rId),
      title: cleanTitle,
      message: cleanMessage,
      type,
      isRead: false,
      createdAt: new Date().toISOString(),
      targetRoute: targetRoute || null,
    };

    // Deduplicate against the most recent 10 notifications for this user with same title & message within 5 seconds
    const isDuplicate = dbNotificationsStore.slice(0, 10).some(
      (n) =>
        String(n.userId).toLowerCase() === String(notifObj.userId).toLowerCase() &&
        n.title === notifObj.title &&
        n.message === notifObj.message &&
        Math.abs(new Date(n.createdAt).getTime() - new Date(notifObj.createdAt).getTime()) < 5000
    );

    if (!isDuplicate) {
      dbNotificationsStore.unshift(notifObj);
    }

    if (dbPool && numericUserId) {
      try {
        const [res] = await dbPool.query(
          `INSERT INTO notifications (user_id, title, message, type, target_route, is_read, created_at)
           VALUES (?, ?, ?, ?, ?, 0, NOW())`,
          [numericUserId, cleanTitle, cleanMessage, type, targetRoute || null]
        );
        if (res && res.insertId) {
          notifObj.id = String(res.insertId);
        }
      } catch (err) {
        // Fallback if target_route column doesn't exist yet
        try {
          const [res2] = await dbPool.query(
            `INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
             VALUES (?, ?, ?, ?, 0, NOW())`,
            [numericUserId, cleanTitle, cleanMessage, type]
          );
          if (res2 && res2.insertId) {
            notifObj.id = String(res2.insertId);
          }
        } catch (innerErr) {
          // MySQL table notice logged
        }
      }
    }

    emitRealtimeEvent('notification:created', notifObj);
    createdNotifs.push(notifObj);
  }

  return createdNotifs;
}

module.exports = {
  stripEmojis,
  resolveUserAliases,
  dispatchNotification,
};
