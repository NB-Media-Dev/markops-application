const express = require('express');
const {
  dbPool,
  dbLeadsStore,
  dbUsersStore,
  dbCallActivitiesStore,
  dbFollowUpsStore,
  dbCommonTargetStore,
  dbTelecallerTargetsStore,
  dbNotificationsStore,
} = require('../db');
const { recordAuditLog } = require('../services/audit.service');
const { emitRealtimeEvent } = require('../events');
const { dispatchNotification } = require('../services/notification.service');
const router = express.Router();

function createNotificationForTelecaller(targetUserId, title, message, targetRoute = '/package-works?package=CAREERMATE&workspace=CURRENT-AFFAIR-PACKAGE&dept=TELECALLING&tab=TELECALLER_MEMBERS') {
  if (!targetUserId) return;
  dispatchNotification({
    userIds: [targetUserId],
    title,
    message,
    type: 'INFO',
    targetRoute,
  }).catch(() => {});
}

router.get('/leads', async (req, res) => {
  const currentRole = String(req.user?.role || req.headers['x-user-role'] || '').toUpperCase();
  const currentUserId = req.user?.id ? String(req.user.id) : (req.headers['x-user-id'] ? String(req.headers['x-user-id']) : null);
  const currentUserEmail = (req.user?.email || req.headers['x-user-email'] || '').toLowerCase().trim();
  const currentUserName = (req.user?.fullName || req.headers['x-user-name'] || '').toLowerCase().trim();
  const isTelecallerRole = currentRole === 'TELECALLER';

  if (dbPool) {
    try {
      let queryStr = `
        SELECT l.*, 
               c.full_name as creator_full_name, 
               c.email as creator_user_email,
               u.full_name as assignee_full_name,
               u.email as assignee_user_email
        FROM leads l
        LEFT JOIN users c ON l.creator_id = c.id
        LEFT JOIN users u ON l.assigned_to = u.id
      `;
      const queryParams = [];

      if (isTelecallerRole) {
        queryStr += `
          WHERE (
            l.assigned_to = ?
            OR (u.email IS NOT NULL AND LOWER(u.email) = ?)
            OR (u.full_name IS NOT NULL AND LOWER(u.full_name) = ?)
          )
        `;
        queryParams.push(
          currentUserId || -1,
          currentUserEmail || '__none__',
          currentUserName || '__none__'
        );
      }

      queryStr += ` ORDER BY l.created_at DESC`;

      const [rows] = await dbPool.query(queryStr, queryParams);
      if (Array.isArray(rows)) {
        const leads = rows.map((row) => {
          const finalCreatorName = row.creator_full_name || row.creator_name || 'System Administrator';
          const finalCreatorEmail = row.creator_user_email || row.creator_email || 'admin@markops.io';
          return {
            id: row.id,
            firstName: row.first_name,
            lastName: row.last_name,
            email: row.email,
            phone: row.phone,
            source: row.source,
            status: row.status,
            assignedTo: row.assigned_to,
            assigned_to: row.assigned_to,
            assigneeName: row.assignee_full_name || (row.assigned_to ? 'Telecaller' : 'Unassigned'),
            creatorId: row.creator_id,
            creator_id: row.creator_id,
            creatorName: finalCreatorName,
            creator_name: finalCreatorName,
            creatorEmail: finalCreatorEmail,
            creator_email: finalCreatorEmail,
            campaignId: row.campaign_id,
            campaignName: row.campaign_name || '',
            createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
            updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
          };
        });

        if (Array.isArray(dbCallActivitiesStore)) {
          leads.forEach((lead) => {
            const lId = String(lead.id || '').trim().toLowerCase();
            const lPhone = String(lead.phone || '').replace(/\D/g, '');
            const lName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim().toLowerCase();

            const leadCalls = dbCallActivitiesStore.filter((c) => {
              const cLeadId = String(c.leadId || '').trim().toLowerCase();
              const cPhone = String(c.leadPhone || c.phone || '').replace(/\D/g, '');
              const cLeadName = String(c.leadName || '').trim().toLowerCase();
              if (cLeadId && lId && cLeadId === lId) return true;
              if (lPhone && cPhone && lPhone === cPhone) return true;
              if (cLeadName && lName && (cLeadName === lName || cLeadName.includes(lName) || lName.includes(cLeadName))) return true;
              return false;
            });

            if (leadCalls.length > 0) {
              const latestCall = leadCalls[0];
              const out = String(latestCall.outcome || '').toUpperCase().replace(/\s+/g, '_');
              lead.status = out === 'BUSY' ? 'LINE_BUSY' : out;
            }
          });
        }

        return res.json(leads);
      }
    } catch (e) {
      console.error('[MySQL DB Error] Failed to fetch leads from MySQL:', e?.message || e);
    }
  }

  // Fallback to in-memory dbLeadsStore
  let leads = [...dbLeadsStore];
  if (isTelecallerRole) {
    leads = leads.filter((l) => {
      const aTo = String(l.assignedTo || l.assigned_to || '').toLowerCase().trim();
      const aName = String(l.assigneeName || l.assignee_name || '').toLowerCase().trim();
      if (currentUserId && aTo === String(currentUserId).toLowerCase().trim()) return true;
      if (currentUserEmail && aTo === currentUserEmail) return true;
      if (currentUserName && (aName === currentUserName || aTo === currentUserName)) return true;
      return false;
    });
  }

  if (Array.isArray(leads) && Array.isArray(dbCallActivitiesStore)) {
    leads.forEach((lead) => {
      const lId = String(lead.id || '').trim().toLowerCase();
      const lPhone = String(lead.phone || '').replace(/\D/g, '');
      const lName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim().toLowerCase();

      const leadCalls = dbCallActivitiesStore.filter((c) => {
        const cLeadId = String(c.leadId || '').trim().toLowerCase();
        const cPhone = String(c.leadPhone || c.phone || '').replace(/\D/g, '');
        const cLeadName = String(c.leadName || '').trim().toLowerCase();
        if (cLeadId && lId && cLeadId === lId) return true;
        if (lPhone && cPhone && lPhone === cPhone) return true;
        if (cLeadName && lName && (cLeadName === lName || cLeadName.includes(lName) || lName.includes(cLeadName))) return true;
        return false;
      });

      if (leadCalls.length > 0) {
        const latestCall = leadCalls[0];
        const out = String(latestCall.outcome || '').toUpperCase().replace(/\s+/g, '_');
        lead.status = out === 'BUSY' ? 'LINE_BUSY' : out;
      }
      if (!lead.creatorName && (lead.creatorId || lead.uploaderId || lead.creatorEmail || lead.uploaderEmail)) {
        const uId = String(lead.creatorId || lead.uploaderId || '').toLowerCase();
        const uEm = String(lead.creatorEmail || lead.uploaderEmail || '').toLowerCase();
        const foundUser = dbUsersStore.find(
          (u) => (uId && String(u.id).toLowerCase() === uId) || (uEm && u.email && u.email.toLowerCase() === uEm)
        );
        if (foundUser) {
          lead.creatorName = foundUser.fullName;
          lead.creatorEmail = foundUser.email;
        }
      }
    });
  }
  return res.json(leads);
});

router.post('/leads', async (req, res) => {
  const { firstName, lastName, email, phone, source, campaignId, campaignName, assignedTo, assigneeName, creatorId, creatorEmail, creatorRole, creatorName, productName, packageName } = req.body;
  const effectiveRole = String(creatorRole || req.headers['x-user-role'] || '').toUpperCase();

  if (effectiveRole === 'TELECALLER' || effectiveRole === 'BDM') {
    return res.status(403).json({ error: 'Access Denied: Role is not authorized to create leads.' });
  }

  const fName = String(firstName || '').trim();
  const lName = String(lastName || '').trim();
  const em = String(email || '').trim();
  const ph = String(phone || '').trim();
  const src = String(source || '').trim();
  const campId = String(campaignId || '').trim();
  const campName = String(campaignName || 'General Intake').trim();
  const targetAssignedTo = assignedTo ? String(assignedTo).trim() : null;
  let targetAssigneeName = targetAssignedTo ? String(assigneeName || 'Assigned Telecaller').trim() : 'Unassigned';

  if (!fName || !lName || !em || !ph || !src) {
    return res.status(400).json({
      error: 'Validation Error: All fields (First Name, Last Name, Email, Phone, Source) are strictly required.',
    });
  }

  const effectiveUserId = creatorId || req.headers['x-user-id'];
  let resolvedCreatorName = creatorName || req.headers['x-user-name'];
  let resolvedCreatorEmail = creatorEmail || req.headers['x-user-email'];

  if ((!resolvedCreatorName || resolvedCreatorName === 'System Administrator') && effectiveUserId) {
    const foundUser = dbUsersStore.find(
      (u) => String(u.id).toLowerCase() === String(effectiveUserId).toLowerCase() || (u.email && u.email.toLowerCase() === String(effectiveUserId).toLowerCase())
    );
    if (foundUser) {
      resolvedCreatorName = foundUser.fullName;
      resolvedCreatorEmail = foundUser.email;
    }
  }

  // 💡 Step 1: Resolve the dynamic integer campaign_id from the database using the campaign name
  let mysqlCampaignId = null;
  if (dbPool) {
    try {
      const [campaigns] = await dbPool.query(
        `SELECT id FROM campaigns WHERE name = ? LIMIT 1`,
        [campName]
      );
      if (campaigns && campaigns.length > 0) {
        mysqlCampaignId = campaigns[0].id;
      } else {
        // Fallback: Use the first active campaign in the table if naming variants exist
        const [firstCmp] = await dbPool.query(`SELECT id FROM campaigns LIMIT 1`);
        if (firstCmp && firstCmp.length > 0) {
          mysqlCampaignId = firstCmp[0].id;
        }
      }
    } catch (dbErr) {
      console.log('[MySQL LookUp Notice] Failed to find parent campaign for lead:', dbErr.message);
    }
  }

  // Final fallback if the database has no matching records
  if (!mysqlCampaignId) {
    mysqlCampaignId = parseInt(campId.replace(/\D/g, ''), 10) || 1;
  }

  // 💡 Step 2: Clean integer constraints for user mappings (e.g. 'usr_1' -> 1)
  const numericCreatorId = parseInt(String(effectiveUserId || '1').replace(/\D/g, ''), 10) || 1;
  const numericAssignedTo = targetAssignedTo ? (parseInt(targetAssignedTo.replace(/\D/g, ''), 10) || null) : null;

  const newLead = {
    id: `lead_${Math.random().toString(36).substring(2, 10)}`,
    firstName: fName,
    lastName: lName,
    email: em,
    phone: ph,
    source: src,
    campaignId: campId, // Retain string identifier for UI memory tracking consistency
    campaignName: campName,
    adId: '',
    status: targetAssignedTo ? 'ASSIGNED' : 'NEW',
    assignedTo: targetAssignedTo,
    assigneeName: targetAssigneeName,
    creatorId: effectiveUserId || '1',
    creatorEmail: resolvedCreatorEmail || creatorEmail || 'admin@markops.io',
    creatorName: resolvedCreatorName || creatorName || 'System Administrator',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  dbLeadsStore.unshift(newLead);

  if (dbPool) {
    try {
      // 💡 Step 3: Insert cleanly using safe numerical columns instead of string tags
      await dbPool.query(
        `INSERT INTO leads (first_name, last_name, email, phone, source, status, assigned_to, creator_id, creator_name, creator_email, campaign_id, campaign_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          newLead.firstName, 
          newLead.lastName, 
          newLead.email, 
          newLead.phone, 
          newLead.source, 
          newLead.status, 
          numericAssignedTo,    // 🟢 Clean integer/null reference
          numericCreatorId,     // 🟢 Clean integer user reference
          newLead.creatorName, 
          newLead.creatorEmail, 
          mysqlCampaignId,      // 🟢 Clean verified campaign integer reference
          newLead.campaignName
        ]
      );
    } catch (e) {
      console.log('[MySQL Notice] Save lead to database failed:', e?.message || e);
    }
  }

  emitRealtimeEvent('lead:created', newLead);
  if (targetAssignedTo) {
    emitRealtimeEvent('lead:assigned', newLead);
    const creator = creatorName || creatorEmail || 'System Administrator';
    const prod = productName || 'Careermate';
    const pkg = packageName || campName || 'CURRENT AFFAIRS AUGUST -2026';
    const msg = `Assigned by: ${creator} -> Product: ${prod} -> Package: ${pkg} -> Total Leads: 1`;
    createNotificationForTelecaller(targetAssignedTo, 'New Lead Assigned', msg);

    if (newLead.creatorId && String(newLead.creatorId) !== String(targetAssignedTo)) {
      dispatchNotification({
        userIds: [newLead.creatorId],
        title: 'Lead Assigned Successfully',
        message: `Lead "${newLead.firstName} ${newLead.lastName || ''}" has been assigned to ${targetAssigneeName}.`,
        type: 'INFO',
        targetRoute: '/leads',
      }).catch(() => {});
    }
  }

  await recordAuditLog(dbPool, {
    actorId: creatorId || req.headers['x-user-id'] || 'usr_admin_01',
    actorEmail: creatorEmail || 'admin@markops.io',
    action: targetAssignedTo ? 'LEAD_CREATED_AND_ASSIGNED' : 'LEAD_CREATED',
    entityType: 'Lead',
    entityId: newLead.id,
    newState: { name: `${newLead.firstName} ${newLead.lastName}`, phone: newLead.phone, assignedTo: targetAssignedTo, campaign: campName },
    ipAddress: req.ip || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
  });
  
  return res.status(201).json(newLead);
});


router.post('/leads/:id/assign', async (req, res) => {
  const { assignedTo, assigneeName, actorId, actorEmail, creatorName, productName, packageName } = req.body;
  const leadId = String(req.params.id).trim();

  let lead = null;
  if (dbPool) {
    try {
      const [rows] = await dbPool.query(
        `SELECT l.*, 
                c.full_name as creator_full_name, 
                c.email as creator_user_email,
                u.full_name as assignee_full_name,
                u.email as assignee_user_email
         FROM leads l
         LEFT JOIN users c ON l.creator_id = c.id
         LEFT JOIN users u ON l.assigned_to = u.id
         WHERE l.id = ?`,
        [leadId]
      );
      if (rows && rows.length > 0) {
        const row = rows[0];
        lead = {
          id: row.id,
          firstName: row.first_name,
          lastName: row.last_name,
          email: row.email,
          phone: row.phone,
          source: row.source,
          status: row.status,
          assignedTo: row.assigned_to,
          assigned_to: row.assigned_to,
          assigneeName: row.assignee_full_name || (row.assigned_to ? 'Telecaller' : 'Unassigned'),
          creatorId: row.creator_id,
          creator_id: row.creator_id,
          creatorName: row.creator_full_name || row.creator_name || 'System Administrator',
          creatorEmail: row.creator_user_email || row.creator_email || 'admin@markops.io',
          campaignId: row.campaign_id,
          campaignName: row.campaign_name || '',
          createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
          updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
        };
      }
    } catch (e) {
      console.error('[MySQL Error] Fetch lead for assign failed:', e.message);
    }
  }

  if (!lead) {
    lead = dbLeadsStore.find((l) => String(l.id).trim() === leadId);
  }

  if (!lead) return res.status(404).json({ error: `Lead #${leadId} not found.` });

  // Strict Creator Authorization: only the user who created this lead (or Administrator) can reassign it
  const currentRole = String(req.user?.role || req.headers['x-user-role'] || '').toUpperCase();
  const currentUserId = req.user?.id ? String(req.user.id) : (req.headers['x-user-id'] ? String(req.headers['x-user-id']) : null);
  const currentUserEmail = (req.user?.email || req.headers['x-user-email'] || '').toLowerCase().trim();
  const currentUserName = (req.user?.fullName || req.headers['x-user-name'] || '').toLowerCase().trim();

  const leadCreatorId = lead.creator_id !== undefined ? String(lead.creator_id) : (lead.creatorId !== undefined ? String(lead.creatorId) : '');
  const leadCreatorEmail = (lead.creator_user_email || lead.creator_email || lead.creatorEmail || '').toLowerCase().trim();
  const leadCreatorName = (lead.creator_full_name || lead.creator_name || lead.creatorName || '').toLowerCase().trim();

  const isCreator = Boolean(
    (currentUserId && leadCreatorId && String(currentUserId) === String(leadCreatorId)) ||
    (currentUserEmail && leadCreatorEmail && currentUserEmail === leadCreatorEmail) ||
    (currentUserName && leadCreatorName && currentUserName === leadCreatorName) ||
    (currentRole === 'ADMINISTRATOR')
  );

  if (!isCreator) {
    return res.status(403).json({ error: 'Access Denied: Only the creator who created this lead can reassign it.' });
  }

  let cleanAssignedTo = null;
  let effectiveName = assigneeName;

  if (assignedTo) {
    const targetUserIdStr = String(assignedTo).trim();
    if (dbPool) {
      try {
        const [userRows] = await dbPool.query(
          `SELECT id, full_name, email FROM users WHERE id = ? OR email = ? LIMIT 1`,
          [targetUserIdStr, targetUserIdStr]
        );
        if (userRows && userRows.length > 0) {
          cleanAssignedTo = userRows[0].id;
          effectiveName = userRows[0].full_name;
        }
      } catch (err) {
        console.error('[MySQL Error] Fetch user for assign failed:', err.message);
      }
    }

    if (!cleanAssignedTo) {
      const user = dbUsersStore.find(
        (u) => String(u.id).trim() === targetUserIdStr || u.email === targetUserIdStr
      );
      if (user) {
        const parsed = parseInt(String(user.id).replace(/\D/g, ''), 10);
        cleanAssignedTo = !isNaN(parsed) && parsed > 0 ? parsed : user.id;
        effectiveName = user.fullName;
      } else {
        const parsed = parseInt(targetUserIdStr.replace(/\D/g, ''), 10);
        cleanAssignedTo = !isNaN(parsed) && parsed > 0 ? parsed : targetUserIdStr;
      }
    }
  }

  const finalStatus = cleanAssignedTo ? 'ASSIGNED' : 'NEW';
  const finalAssigneeName = cleanAssignedTo ? (effectiveName || 'Assigned Telecaller') : 'Unassigned';

  // Update in MySQL
  if (dbPool) {
    try {
      const numLeadId = parseInt(leadId, 10);
      if (!isNaN(numLeadId)) {
        await dbPool.query(
          `UPDATE leads 
           SET assigned_to = ?, status = ?, updated_at = NOW() 
           WHERE id = ?`,
          [cleanAssignedTo ? (parseInt(String(cleanAssignedTo).replace(/\D/g, ''), 10) || cleanAssignedTo) : null, finalStatus, numLeadId]
        );
      }
    } catch (e) {
      console.error('[MySQL Error] Update lead assignment failed:', e.message);
    }
  }

  // Update in-memory store
  const storeIdx = dbLeadsStore.findIndex((l) => String(l.id).trim() === leadId);
  if (storeIdx !== -1) {
    dbLeadsStore[storeIdx].assignedTo = cleanAssignedTo ? String(cleanAssignedTo) : null;
    dbLeadsStore[storeIdx].assigned_to = cleanAssignedTo ? String(cleanAssignedTo) : null;
    dbLeadsStore[storeIdx].assigneeName = finalAssigneeName;
    dbLeadsStore[storeIdx].status = finalStatus;
    dbLeadsStore[storeIdx].updatedAt = new Date().toISOString();
  }

  lead.assignedTo = cleanAssignedTo ? String(cleanAssignedTo) : null;
  lead.assigned_to = cleanAssignedTo ? String(cleanAssignedTo) : null;
  lead.assigneeName = finalAssigneeName;
  lead.status = finalStatus;
  lead.updatedAt = new Date().toISOString();

  emitRealtimeEvent('lead:assigned', lead);
  emitRealtimeEvent('lead:updated', lead);

  if (lead.assignedTo) {
    const creator = creatorName || actorEmail || lead.creatorName || 'System Administrator';
    const prod = productName || 'Careermate';
    const pkg = packageName || lead.campaignName || 'CURRENT AFFAIRS AUGUST -2026';
    const msg = `Assigned by: ${creator} -> Product: ${prod} -> Package: ${pkg} -> Total Leads: 1`;
    createNotificationForTelecaller(lead.assignedTo, 'New Lead Assigned', msg);

    const reassignerId = actorId || req.headers['x-user-id'] || lead.creatorId;
    if (reassignerId && String(reassignerId) !== String(lead.assignedTo)) {
      dispatchNotification({
        userIds: [reassignerId],
        title: 'Lead Assigned Successfully',
        message: `Lead "${lead.firstName} ${lead.lastName || ''}" has been assigned to ${lead.assigneeName}.`,
        type: 'INFO',
        targetRoute: '/leads',
      }).catch(() => {});
    }
  }

  await recordAuditLog(dbPool, {
    actorId: actorId || req.headers['x-user-id'] || 'usr_admin_01',
    actorEmail: actorEmail || 'admin@markops.io',
    action: 'LEAD_REASSIGNED',
    entityType: 'Lead',
    entityId: lead.id,
    newState: { assignedTo: lead.assignedTo, assigneeName: lead.assigneeName, status: lead.status },
    ipAddress: req.ip || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
  });
  return res.json(lead);
});

// PUT /api/leads/:id - Update lead details (Creator-only)
router.put('/leads/:id', async (req, res) => {
  const leadId = req.params.id;
  const currentRole = String(req.user?.role || req.headers['x-user-role'] || '').toUpperCase();
  const currentUserId = req.user?.id ? String(req.user.id) : (req.headers['x-user-id'] ? String(req.headers['x-user-id']) : null);
  const currentUserEmail = (req.user?.email || req.headers['x-user-email'] || '').toLowerCase().trim();
  const currentUserName = (req.user?.fullName || req.headers['x-user-name'] || '').toLowerCase().trim();

  let lead = null;
  if (dbPool) {
    try {
      const [rows] = await dbPool.query(
        `SELECT l.*, c.full_name as creator_full_name, c.email as creator_user_email, u.full_name as assignee_full_name
         FROM leads l
         LEFT JOIN users c ON l.creator_id = c.id
         LEFT JOIN users u ON l.assigned_to = u.id
         WHERE l.id = ?`,
        [leadId]
      );
      if (rows && rows.length > 0) {
        lead = rows[0];
      }
    } catch (e) {
      console.error('[MySQL Error] Fetch lead for edit failed:', e.message);
    }
  }
  if (!lead) {
    lead = dbLeadsStore.find((l) => String(l.id) === String(leadId));
  }

  if (!lead) {
    return res.status(404).json({ error: 'Lead not found.' });
  }

  // Strict Creator Authorization
  const leadCreatorId = lead.creator_id !== undefined ? String(lead.creator_id) : (lead.creatorId !== undefined ? String(lead.creatorId) : '');
  const leadCreatorEmail = (lead.creator_user_email || lead.creator_email || lead.creatorEmail || '').toLowerCase().trim();
  const leadCreatorName = (lead.creator_full_name || lead.creator_name || lead.creatorName || '').toLowerCase().trim();

  const isCreator = Boolean(
    (currentUserId && leadCreatorId && String(currentUserId) === String(leadCreatorId)) ||
    (currentUserEmail && leadCreatorEmail && currentUserEmail === leadCreatorEmail) ||
    (currentUserName && leadCreatorName && currentUserName === leadCreatorName) ||
    (currentRole === 'ADMINISTRATOR')
  );

  if (!isCreator) {
    return res.status(403).json({ error: 'Access Denied: Only the creator who created this lead can edit it.' });
  }

  const { firstName, lastName, email, phone, source, status, campaignName, assignedTo, assigneeName } = req.body;
  const updatedFirstName = firstName !== undefined ? String(firstName).trim() : (lead.first_name || lead.firstName);
  const updatedLastName = lastName !== undefined ? String(lastName).trim() : (lead.last_name || lead.lastName || '');
  const updatedEmail = email !== undefined ? String(email).trim() : (lead.email || '');
  const updatedPhone = phone !== undefined ? String(phone).trim() : (lead.phone || '');
  const updatedSource = source !== undefined ? String(source).trim() : (lead.source || 'Manual');
  const updatedStatus = status !== undefined ? String(status).trim() : (lead.status || 'NEW');
  const updatedCampName = campaignName !== undefined ? String(campaignName).trim() : (lead.campaign_name || lead.campaignName || '');
  const updatedAssignedTo = assignedTo !== undefined ? (assignedTo ? parseInt(String(assignedTo).replace(/\D/g, ''), 10) || null : null) : (lead.assigned_to || null);
  let updatedAssigneeName = assigneeName !== undefined ? String(assigneeName).trim() : (lead.assignee_full_name || lead.assigneeName || 'Unassigned');
  if (!updatedAssignedTo) updatedAssigneeName = 'Unassigned';

  if (dbPool) {
    try {
      await dbPool.query(
        `UPDATE leads 
         SET first_name = ?, last_name = ?, email = ?, phone = ?, source = ?, status = ?, campaign_name = ?, assigned_to = ?, updated_at = NOW()
         WHERE id = ?`,
        [updatedFirstName, updatedLastName, updatedEmail, updatedPhone, updatedSource, updatedStatus, updatedCampName, updatedAssignedTo, leadId]
      );
    } catch (dbErr) {
      console.error('[MySQL Error] Update lead failed:', dbErr.message);
    }
  }

  const updatedObj = {
    id: leadId,
    firstName: updatedFirstName,
    lastName: updatedLastName,
    email: updatedEmail,
    phone: updatedPhone,
    source: updatedSource,
    status: updatedStatus,
    campaignId: lead.campaign_id || lead.campaignId || 'cmp_default',
    campaignName: updatedCampName,
    assignedTo: updatedAssignedTo,
    assigneeName: updatedAssigneeName,
    creatorId: leadCreatorId,
    creatorName: lead.creator_full_name || lead.creator_name || lead.creatorName,
    creatorEmail: lead.creator_user_email || lead.creator_email || lead.creatorEmail,
    updatedAt: new Date().toISOString(),
  };

  const storeIdx = dbLeadsStore.findIndex((l) => String(l.id) === String(leadId));
  if (storeIdx !== -1) {
    dbLeadsStore[storeIdx] = { ...dbLeadsStore[storeIdx], ...updatedObj };
  }

  emitRealtimeEvent('lead:updated', updatedObj);
  await recordAuditLog(dbPool, {
    actorId: currentUserId || 'usr_unknown',
    actorEmail: currentUserEmail || 'unknown@markops.io',
    action: 'LEAD_UPDATED',
    entityType: 'Lead',
    entityId: String(leadId),
    newState: updatedObj,
    ipAddress: req.ip || req.socket?.remoteAddress,
  });

  return res.json({ success: true, lead: updatedObj });
});

// DELETE /api/leads/:id - Delete lead (Creator-only)
router.delete('/leads/:id', async (req, res) => {
  const leadId = req.params.id;
  const currentRole = String(req.user?.role || req.headers['x-user-role'] || '').toUpperCase();
  const currentUserId = req.user?.id ? String(req.user.id) : (req.headers['x-user-id'] ? String(req.headers['x-user-id']) : null);
  const currentUserEmail = (req.user?.email || req.headers['x-user-email'] || '').toLowerCase().trim();
  const currentUserName = (req.user?.fullName || req.headers['x-user-name'] || '').toLowerCase().trim();

  let lead = null;
  if (dbPool) {
    try {
      const [rows] = await dbPool.query(
        `SELECT l.*, c.full_name as creator_full_name, c.email as creator_user_email
         FROM leads l
         LEFT JOIN users c ON l.creator_id = c.id
         WHERE l.id = ?`,
        [leadId]
      );
      if (rows && rows.length > 0) {
        lead = rows[0];
      }
    } catch (e) {
      console.error('[MySQL Error] Fetch lead for delete failed:', e.message);
    }
  }
  if (!lead) {
    lead = dbLeadsStore.find((l) => String(l.id) === String(leadId));
  }

  if (!lead) {
    return res.status(404).json({ error: 'Lead not found.' });
  }

  // Strict Creator Authorization
  const leadCreatorId = lead.creator_id !== undefined ? String(lead.creator_id) : (lead.creatorId !== undefined ? String(lead.creatorId) : '');
  const leadCreatorEmail = (lead.creator_user_email || lead.creator_email || lead.creatorEmail || '').toLowerCase().trim();
  const leadCreatorName = (lead.creator_full_name || lead.creator_name || lead.creatorName || '').toLowerCase().trim();

  const isCreator = Boolean(
    (currentUserId && leadCreatorId && String(currentUserId) === String(leadCreatorId)) ||
    (currentUserEmail && leadCreatorEmail && currentUserEmail === leadCreatorEmail) ||
    (currentUserName && leadCreatorName && currentUserName === leadCreatorName) ||
    (currentRole === 'ADMINISTRATOR')
  );

  if (!isCreator) {
    return res.status(403).json({ error: 'Access Denied: Only the creator who created this lead can delete it.' });
  }

  if (dbPool) {
    try {
      await dbPool.query(`DELETE FROM follow_ups WHERE lead_id = ?`, [leadId]).catch(() => {});
      await dbPool.query(`DELETE FROM call_activities WHERE lead_id = ?`, [leadId]).catch(() => {});
      await dbPool.query(`DELETE FROM leads WHERE id = ?`, [leadId]);
    } catch (dbErr) {
      console.error('[MySQL Error] Delete lead failed:', dbErr.message);
    }
  }

  const storeIdx = dbLeadsStore.findIndex((l) => String(l.id) === String(leadId));
  if (storeIdx !== -1) {
    dbLeadsStore.splice(storeIdx, 1);
  }

  emitRealtimeEvent('lead:deleted', { leadId: String(leadId) });
  await recordAuditLog(dbPool, {
    actorId: currentUserId || 'usr_unknown',
    actorEmail: currentUserEmail || 'unknown@markops.io',
    action: 'LEAD_DELETED',
    entityType: 'Lead',
    entityId: String(leadId),
    ipAddress: req.ip || req.socket?.remoteAddress,
  });

  return res.json({ success: true, message: 'Lead deleted successfully.', leadId });
});

router.get('/calls', (req, res) => {
  const { telecallerId, userId, telecallerName } = req.query;
  if (telecallerId || userId || telecallerName) {
    const targetId = String(telecallerId || userId || '').trim().toLowerCase();
    const targetName = String(telecallerName || '').trim().toLowerCase();
    const filtered = dbCallActivitiesStore.filter((c) => {
      const cId = String(c.telecallerId || '').trim().toLowerCase();
      const cName = String(c.telecallerName || '').trim().toLowerCase();
      const cEmail = String(c.telecallerEmail || '').trim().toLowerCase();
      if (targetId && (cId === targetId || cEmail === targetId)) return true;
      if (targetName && (cName === targetName || cName.includes(targetName) || targetName.includes(cName))) return true;
      return false;
    });
    return res.json(filtered);
  }
  return res.json(dbCallActivitiesStore);
});

router.post('/calls', async (req, res) => {
  const { leadId, leadPhone, phone, leadName, firstName, lastName, outcome, durationSeconds, remarks, nextAction, followUpDate, followUpTime, telecallerId, telecallerName, telecallerEmail } = req.body;
  const rawLeadId = String(leadId || '').trim();
  const rawPhone = String(leadPhone || phone || '').replace(/\D/g, '');
  const rawName = String(leadName || `${firstName || ''} ${lastName || ''}` || '').trim().toLowerCase();

  const outcomeUpper = String(outcome || 'CONNECTED').toUpperCase().replace(/\s+/g, '_');
  let newStatus = outcomeUpper === 'BUSY' ? 'LINE_BUSY' : outcomeUpper;

  let lead = null;
  const numId = parseInt(rawLeadId, 10);

  if (dbPool) {
    try {
      if (!isNaN(numId)) {
        await dbPool.query('UPDATE leads SET status = ?, updated_at = NOW() WHERE id = ?', [newStatus, numId]);
      } else if (rawPhone) {
        await dbPool.query('UPDATE leads SET status = ?, updated_at = NOW() WHERE phone LIKE ?', [newStatus, `%${rawPhone}%`]);
      }

      // Fetch authentic lead record from MySQL so campaign and assignment metadata are preserved
      let fetchSql = `
        SELECT l.*, 
               c.full_name as creator_full_name, 
               c.email as creator_user_email,
               u.full_name as assignee_full_name,
               u.email as assignee_user_email
        FROM leads l
        LEFT JOIN users c ON l.creator_id = c.id
        LEFT JOIN users u ON l.assigned_to = u.id
      `;
      let params = [];
      if (!isNaN(numId)) {
        fetchSql += ' WHERE l.id = ?';
        params = [numId];
      } else if (rawPhone) {
        fetchSql += ' WHERE l.phone LIKE ?';
        params = [`%${rawPhone}%`];
      }

      if (params.length > 0) {
        const [rows] = await dbPool.query(fetchSql, params);
        if (Array.isArray(rows) && rows.length > 0) {
          const row = rows[0];
          lead = {
            id: row.id,
            firstName: row.first_name,
            lastName: row.last_name,
            email: row.email,
            phone: row.phone,
            source: row.source,
            status: row.status,
            assignedTo: row.assigned_to,
            assigned_to: row.assigned_to,
            assigneeName: row.assignee_full_name || (row.assigned_to ? 'Telecaller' : 'Unassigned'),
            creatorId: row.creator_id,
            creator_id: row.creator_id,
            creatorName: row.creator_full_name || row.creator_name || 'System Administrator',
            creatorEmail: row.creator_user_email || row.creator_email || 'admin@markops.io',
            campaignId: row.campaign_id,
            campaignName: row.campaign_name || '',
            createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
            updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
          };
        }
      }
    } catch (e) {
      console.error('[MySQL Error] Failed to update and fetch lead in POST /calls:', e?.message || e);
    }
  }

  if (!lead) {
    lead = dbLeadsStore.find((l) => String(l.id).trim() === rawLeadId);
    if (!lead && rawPhone) {
      lead = dbLeadsStore.find((l) => l.phone && l.phone.replace(/\D/g, '') === rawPhone);
    }
    if (!lead && rawLeadId) {
      const leadIdDigits = rawLeadId.replace(/\D/g, '');
      lead = dbLeadsStore.find(
        (l) =>
          (leadIdDigits && l.phone && l.phone.replace(/\D/g, '') === leadIdDigits) ||
          `${l.firstName} ${l.lastName || ''}`.trim().toLowerCase() === rawLeadId.toLowerCase()
      );
    }
    if (!lead && rawName) {
      lead = dbLeadsStore.find((l) => `${l.firstName} ${l.lastName || ''}`.trim().toLowerCase() === rawName);
    }

    if (lead) {
      lead.status = newStatus;
      lead.updatedAt = new Date().toISOString();
    } else if (rawLeadId || rawName || rawPhone) {
      lead = {
        id: rawLeadId || `lead_${Math.random().toString(36).substring(2, 10)}`,
        firstName: firstName || (leadName ? leadName.split(' ')[0] : 'Lead'),
        lastName: lastName || (leadName ? leadName.split(' ').slice(1).join(' ') : 'Customer'),
        phone: leadPhone || phone || '+91 9800000000',
        source: 'Digital Ads Lead Form',
        campaignId: 'cmp_default',
        campaignName: 'Digital Ad Campaign',
        status: newStatus,
        assignedTo: telecallerId || null,
        assigneeName: telecallerName || 'Assigned Telecaller',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      dbLeadsStore.unshift(lead);
    }
  }

  const effectiveCallerId = telecallerId || req.headers['x-user-id'] || 'usr_admin_01';
  const effectiveCallerName = telecallerName || req.headers['x-user-name'] || 'System User';

  const newCall = {
    id: `call_${Math.random().toString(36).substring(2, 10)}`,
    leadId: lead ? lead.id : rawLeadId,
    leadPhone: lead ? lead.phone : (leadPhone || phone || ''),
    leadName: lead ? `${lead.firstName} ${lead.lastName || ''}`.trim() : (req.body.leadName || 'Lead Customer'),
    telecallerId: effectiveCallerId,
    telecallerName: effectiveCallerName,
    telecallerEmail: telecallerEmail || req.headers['x-user-email'] || '',
    outcome: outcomeUpper,
    durationSeconds: Number(durationSeconds) || 120,
    remarks: remarks || 'Call logged.',
    nextAction: nextAction || 'Follow up as required',
    followUpDate: followUpDate || '',
    followUpTime: followUpTime || '',
    calledAt: new Date().toISOString(),
  };

  dbCallActivitiesStore.unshift(newCall);
  emitRealtimeEvent('call:completed', newCall);

  const finalLead = lead || {
    id: rawLeadId,
    status: newStatus,
    updatedAt: new Date().toISOString(),
  };

  emitRealtimeEvent('lead:status_changed', { leadId: finalLead.id, status: newStatus });
  emitRealtimeEvent('lead:updated', finalLead);

  // Mark previous follow-ups for this lead as COMPLETED
  const targetLeadId = newCall.leadId;
  const targetPhone = newCall.leadPhone ? String(newCall.leadPhone).replace(/\D/g, '') : '';
  dbFollowUpsStore.forEach((f) => {
    const fPhone = f.leadPhone ? String(f.leadPhone).replace(/\D/g, '') : '';
    if (f.leadId === targetLeadId || (targetPhone && fPhone && targetPhone === fPhone)) {
      if (f.status === 'PENDING') {
        f.status = 'COMPLETED';
      }
    }
  });

  if (dbPool) {
    try {
      await dbPool.query("UPDATE lead_follow_ups SET status = 'COMPLETED' WHERE (lead_id = ? OR lead_phone LIKE ?) AND status = 'PENDING'", [targetLeadId, `%${targetPhone}%`]);
    } catch (e) {
      // Table may not exist in pure JSON memory mode
    }
  }

  if (followUpDate) {
    dbFollowUpsStore.unshift({
      id: `fol_${Math.random().toString(36).substring(2, 10)}`,
      leadId: newCall.leadId,
      leadName: newCall.leadName,
      leadPhone: lead ? lead.phone : (leadPhone || phone || ''),
      telecallerId: effectiveCallerId,
      telecallerName: effectiveCallerName,
      dueDate: followUpDate,
      dueTime: followUpTime || '10:00',
      status: 'PENDING',
      notes: remarks,
      createdAt: new Date().toISOString(),
    });
  }

  await recordAuditLog(dbPool, {
    actorId: effectiveCallerId,
    actorEmail: telecallerEmail || 'telecaller@markops.io',
    action: `TELECALL_LOGGED_${outcomeUpper}`,
    entityType: 'CallActivity',
    entityId: newCall.id,
    newState: { outcome: outcomeUpper, leadId: finalLead.id, newStatus },
    ipAddress: req.ip || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
  });

  // --------------------------------------------------------------------------
  // NOTIFICATIONS MATRIX: DIGITAL MARKETING <--> TELECALLING FLOW
  // --------------------------------------------------------------------------

  // 1. OUTCOME: INTERESTED
  if (outcomeUpper === 'INTERESTED' || newStatus === 'INTERESTED') {
    const creatorTarget = (lead && lead.creatorId) ? lead.creatorId : '4';

    // Notify Digital Marketing / Lead Creator
    dispatchNotification({
      userIds: [creatorTarget, '4'],
      title: `Lead Interested: ${finalLead.firstName} ${finalLead.lastName || ''}`.trim(),
      message: `Lead "${finalLead.firstName} ${finalLead.lastName || ''}".trim() (${newCall.leadPhone}) has shown interest! Handled by ${effectiveCallerName}. Campaign: ${finalLead.campaignName || 'Digital Campaign'}.`,
      type: 'SUCCESS',
      targetRoute: '/leads',
    }).catch(() => {});

    // Notify Telecaller
    dispatchNotification({
      userIds: [effectiveCallerId],
      title: 'Lead Marked as Interested',
      message: `You marked "${finalLead.firstName} ${finalLead.lastName || ''}".trim() as Interested. Great job!`,
      type: 'SUCCESS',
      targetRoute: '/telecalling',
    }).catch(() => {});
  }

  // 2. OUTCOME: QUALIFIED
  if (outcomeUpper === 'QUALIFIED' || newStatus === 'QUALIFIED') {
    const creatorTarget = (lead && lead.creatorId) ? lead.creatorId : '4';

    // Notify Digital Marketing / Creator
    dispatchNotification({
      userIds: [creatorTarget, '4'],
      title: `Lead Qualified: ${finalLead.firstName} ${finalLead.lastName || ''}`.trim(),
      message: `High-value lead "${finalLead.firstName} ${finalLead.lastName || ''}".trim() (${newCall.leadPhone}) has been qualified by ${effectiveCallerName}! Ready for package conversion.`,
      type: 'SUCCESS',
      targetRoute: '/leads',
    }).catch(() => {});

    // Notify BDM (role BDM / user ID 2)
    dispatchNotification({
      userIds: ['2'],
      title: `New Qualified Lead: ${finalLead.firstName} ${finalLead.lastName || ''}`.trim(),
      message: `Lead "${finalLead.firstName} ${finalLead.lastName || ''}".trim() was qualified by ${effectiveCallerName}. Ready for package proposal and deal closure.`,
      type: 'SUCCESS',
      targetRoute: '/package-works',
    }).catch(() => {});

    // Notify Telecaller
    dispatchNotification({
      userIds: [effectiveCallerId],
      title: 'Lead Qualified!',
      message: `Lead "${finalLead.firstName} ${finalLead.lastName || ''}".trim() has been successfully qualified! Target milestone progressed.`,
      type: 'SUCCESS',
      targetRoute: '/telecalling',
    }).catch(() => {});
  }

  // 3. TARGET ACHIEVE EVALUATION & NOTIFICATIONS
  try {
    const todayDateStr = new Date().toISOString().split('T')[0];
    const callerIdStr = String(effectiveCallerId).toLowerCase();
    const todayCallerCalls = dbCallActivitiesStore.filter((c) => {
      const isCaller = String(c.telecallerId || '').toLowerCase() === callerIdStr || (c.telecallerName && c.telecallerName === effectiveCallerName);
      const isToday = c.calledAt && c.calledAt.startsWith(todayDateStr);
      return isCaller && isToday;
    });

    // 1 per 1 lead: Count UNIQUE leads called today
    const uniqueLeadKeys = new Set();
    const uniqueInterestedLeadKeys = new Set();

    todayCallerCalls.forEach((c) => {
      const leadKey = String(c.leadId || c.leadPhone || c.leadName || '').trim().toLowerCase();
      if (leadKey) {
        uniqueLeadKeys.add(leadKey);
        if (c.outcome === 'INTERESTED' || c.outcome === 'QUALIFIED') {
          uniqueInterestedLeadKeys.add(leadKey);
        }
      }
    });

    const todayCallsCount = uniqueLeadKeys.size;
    const todayInterestedCount = uniqueInterestedLeadKeys.size;
    const targetCalls = dbCommonTargetStore.dailyCallsTarget || 30;
    const targetInterested = dbCommonTargetStore.dailyInterestedTarget || 5;

    const isAchieved = todayCallsCount >= targetCalls || todayInterestedCount >= targetInterested;
    if (isAchieved) {
      const alreadyNotified = dbNotificationsStore.some(
        (n) =>
          String(n.userId).toLowerCase() === callerIdStr &&
          n.title &&
          n.title.toLowerCase().includes('target achieved') &&
          n.createdAt &&
          n.createdAt.startsWith(todayDateStr)
      );

      if (!alreadyNotified) {
        // Notify Telecaller
        dispatchNotification({
          userIds: [effectiveCallerId],
          title: 'Target Achieved! Congratulations!',
          message: `Outstanding work, ${effectiveCallerName}! You have successfully achieved your daily target today (${todayCallsCount}/${targetCalls} unique leads called, ${todayInterestedCount}/${targetInterested} interested leads).`,
          type: 'SUCCESS',
          targetRoute: '/package-works?package=CAREERMATE&workspace=CURRENT-AFFAIR-PACKAGE&dept=TELECALLING&tab=TELECALLER_MEMBERS',
        }).catch(() => {});

        // Notify Digital Marketer (4), Admin (1), Marketing Manager (3), BDM (2)
        dispatchNotification({
          userIds: ['4', '1', '2', '3'],
          title: `Telecaller Target Achieved: ${effectiveCallerName}`,
          message: `${effectiveCallerName} has reached their daily target today with ${todayCallsCount} unique leads called and ${todayInterestedCount} interested/qualified leads!`,
          type: 'SUCCESS',
          targetRoute: '/package-works?package=CAREERMATE&workspace=CURRENT-AFFAIR-PACKAGE&dept=TELECALLING&tab=TELECALLER_MEMBERS',
        }).catch(() => {});
      }
    }
  } catch (targetErr) {
    console.error('Target achievement evaluation notice:', targetErr?.message || targetErr);
  }

  return res.status(201).json({ call: newCall, lead: finalLead });
});

// PATCH /api/leads/:id/status - Update lead status directly with notifications
router.patch('/leads/:id/status', async (req, res) => {
  const { status, actorId, actorName, actorEmail } = req.body;
  const leadId = String(req.params.id).trim();

  let lead = null;
  if (dbPool) {
    try {
      const [rows] = await dbPool.query(
        `SELECT l.*, 
                c.full_name as creator_full_name, 
                c.email as creator_user_email,
                u.full_name as assignee_full_name,
                u.email as assignee_user_email
         FROM leads l
         LEFT JOIN users c ON l.creator_id = c.id
         LEFT JOIN users u ON l.assigned_to = u.id
         WHERE l.id = ?`,
        [leadId]
      );
      if (rows && rows.length > 0) {
        const row = rows[0];
        lead = {
          id: row.id,
          firstName: row.first_name,
          lastName: row.last_name,
          email: row.email,
          phone: row.phone,
          source: row.source,
          status: row.status,
          assignedTo: row.assigned_to,
          assigned_to: row.assigned_to,
          assigneeName: row.assignee_full_name || (row.assigned_to ? 'Telecaller' : 'Unassigned'),
          creatorId: row.creator_id,
          creator_id: row.creator_id,
          creatorName: row.creator_full_name || row.creator_name || 'System Administrator',
          creatorEmail: row.creator_user_email || row.creator_email || 'admin@markops.io',
          campaignId: row.campaign_id,
          campaignName: row.campaign_name || '',
          createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
          updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
        };
      }
    } catch (e) {
      console.error('[MySQL Error] Fetch lead for status update failed:', e.message);
    }
  }

  if (!lead) {
    lead = dbLeadsStore.find((l) => String(l.id).trim() === leadId);
  }

  if (!lead) return res.status(404).json({ error: `Lead #${leadId} not found.` });

  const previousStatus = lead.status;
  const newStatus = String(status || '').toUpperCase().trim();
  lead.status = newStatus;
  lead.updatedAt = new Date().toISOString();

  if (dbPool) {
    try {
      const numId = parseInt(leadId, 10);
      if (!isNaN(numId)) {
        await dbPool.query('UPDATE leads SET status = ?, updated_at = NOW() WHERE id = ?', [newStatus, numId]);
      }
    } catch (e) {
      console.error('[MySQL Error] Failed to update lead status:', e?.message || e);
    }
  }

  emitRealtimeEvent('lead:status_changed', { leadId: lead.id, status: newStatus });
  emitRealtimeEvent('lead:updated', lead);

  const effectiveActorName = actorName || req.headers['x-user-name'] || lead.assigneeName || 'Telecaller';
  const effectiveActorId = actorId || req.headers['x-user-id'] || lead.assignedTo || '6';

  // Notifications on status change
  if (newStatus === 'INTERESTED') {
    const creatorTarget = lead.creatorId || '4';
    dispatchNotification({
      userIds: [creatorTarget, '4'],
      title: `Lead Interested: ${lead.firstName} ${lead.lastName || ''}`.trim(),
      message: `Lead "${lead.firstName} ${lead.lastName || ''}".trim() has shown interest! Handled by ${effectiveActorName}. Campaign: ${lead.campaignName || 'Digital Campaign'}.`,
      type: 'SUCCESS',
      targetRoute: '/leads',
    }).catch(() => {});

    if (lead.assignedTo) {
      dispatchNotification({
        userIds: [lead.assignedTo],
        title: 'Lead Marked as Interested',
        message: `You marked "${lead.firstName} ${lead.lastName || ''}".trim() as Interested. Great job!`,
        type: 'SUCCESS',
        targetRoute: '/telecalling',
      }).catch(() => {});
    }
  } else if (newStatus === 'QUALIFIED') {
    const creatorTarget = lead.creatorId || '4';
    dispatchNotification({
      userIds: [creatorTarget, '4'],
      title: `Lead Qualified: ${lead.firstName} ${lead.lastName || ''}`.trim(),
      message: `High-value lead "${lead.firstName} ${lead.lastName || ''}".trim() has been qualified by ${effectiveActorName}! Ready for package conversion.`,
      type: 'SUCCESS',
      targetRoute: '/leads',
    }).catch(() => {});

    dispatchNotification({
      userIds: ['2'],
      title: `New Qualified Lead for Conversion: ${lead.firstName} ${lead.lastName || ''}`.trim(),
      message: `Lead "${lead.firstName} ${lead.lastName || ''}".trim() was qualified by ${effectiveActorName}. Ready for package conversion.`,
      type: 'SUCCESS',
      targetRoute: '/package-works',
    }).catch(() => {});

    if (lead.assignedTo) {
      dispatchNotification({
        userIds: [lead.assignedTo],
        title: 'Lead Qualified!',
        message: `Lead "${lead.firstName} ${lead.lastName || ''}".trim() has been successfully qualified! Target milestone progressed.`,
        type: 'SUCCESS',
        targetRoute: '/telecalling',
      }).catch(() => {});
    }
  }

  return res.json(lead);
});

router.get('/followups', (req, res) => {
  return res.json(dbFollowUpsStore);
});

// POST /api/leads/batch-import - Batch Excel/CSV upload with Equal Auto-Assignment among Telecallers
router.post('/leads/batch-import', async (req, res) => {
  const { leads, selectedTelecallerIds, campaignId, campaignName, source, uploaderId, uploaderEmail, uploaderRole } = req.body;
  const effectiveRole = String(uploaderRole || req.headers['x-user-role'] || '').toUpperCase();

  if (effectiveRole === 'TELECALLER') {
    return res.status(403).json({
      error: 'Access Denied: Telecallers are not authorized to upload lead files. Upload is strictly restricted to Digital Marketing role.',
    });
  }

  if (!Array.isArray(leads) || leads.length === 0) {
    return res.status(400).json({ error: 'No lead array provided in request payload.' });
  }

  // Validate that all 5 fields exist for every lead in the array
  for (let i = 0; i < leads.length; i++) {
    const raw = leads[i];
    const fName = String(raw.firstName || raw['First Name'] || raw['first_name'] || '').trim();
    const lName = String(raw.lastName || raw['Last Name'] || raw['last_name'] || '').trim();
    const em = String(raw.email || raw['Email'] || raw['email_address'] || '').trim();
    const ph = String(raw.phone || raw['Phone'] || raw['Mobile'] || '').trim();
    const src = String(raw.source || raw['Source'] || source || '').trim();

    if (!fName || !lName || !em || !ph || !src) {
      return res.status(400).json({
        error: `Validation Error on row #${i + 1}: All 5 fields (First Name, Last Name, Email, Phone, Source) are strictly required. Missing values detected.`,
      });
    }
  }

  // 1. Determine active telecallers to distribute leads among (STRICTLY TELECALLER role only)
  let telecallers = dbUsersStore.filter((u) => u.role === 'TELECALLER' && u.isActive !== false);

  // Sync any telecallers supplied from frontend payload if not already in store
  if (Array.isArray(req.body.telecallersList) && req.body.telecallersList.length > 0) {
    req.body.telecallersList.forEach((reqTc) => {
      if (!telecallers.some((t) => t.id === reqTc.id)) {
        const syncedTc = {
          id: reqTc.id,
          fullName: reqTc.fullName || 'Telecaller User',
          email: reqTc.email || `${reqTc.id}@markops.io`,
          role: 'TELECALLER',
          isActive: true,
        };
        telecallers.push(syncedTc);
        if (!dbUsersStore.some((u) => u.id === reqTc.id)) {
          dbUsersStore.push(syncedTc);
        }
      }
    });
  }

  if (Array.isArray(selectedTelecallerIds) && selectedTelecallerIds.length > 0) {
    const selectedSet = new Set(selectedTelecallerIds);
    const filteredSelected = telecallers.filter((u) => selectedSet.has(u.id));
    if (filteredSelected.length > 0) {
      telecallers = filteredSelected;
    }
  }

  // Fallback default telecallers if no telecallers are present
  if (telecallers.length === 0) {
    telecallers = [];
  }

  // 💡 Step 1: Look up the real database integer ID using the campaign name before running the loop
  let mysqlCampaignId = 1; 
  const targetCampName = campaignName || 'Digital Ad Campaign';
  if (dbPool) {
    try {
      const [campaignRows] = await dbPool.query(
        `SELECT id FROM campaigns WHERE name = ? LIMIT 1`,
        [targetCampName]
      );
      if (campaignRows && campaignRows.length > 0) {
        mysqlCampaignId = campaignRows[0].id; // Extract numerical key
      } else {
        const [firstCmp] = await dbPool.query(`SELECT id FROM campaigns LIMIT 1`);
        if (firstCmp && firstCmp.length > 0) {
          mysqlCampaignId = firstCmp[0].id;
        }
      }
    } catch (dbErr) {
      console.log('[MySQL LookUp Notice] Failed to find campaign reference for batch upload:', dbErr.message);
    }
  }

  const createdLeads = [];
  const allocationSummary = {};
  telecallers.forEach((tc) => {
    allocationSummary[tc.id] = { id: tc.id, fullName: tc.fullName, email: tc.email, count: 0 };
  });

  // 2. Perform Round-Robin Equal Assignment
  for (let i = 0; i < leads.length; i++) {
    const raw = leads[i];
    const assignedTelecaller = telecallers.length > 0 ? telecallers[i % telecallers.length] : null;

    const firstName = String(raw.firstName || raw['First Name'] || raw['first_name'] || raw['Name'] || `Lead ${i + 1}`).trim();
    const lastName = String(raw.lastName || raw['Last Name'] || raw['last_name'] || '').trim();
    const email = String(raw.email || raw['Email'] || raw['email_address'] || '').trim();
    const phone = String(raw.phone || raw['Phone'] || raw['Mobile'] || raw['Contact'] || `+91 ${9000000000 + i}`).trim();

    const uploaderUid = req.body.creatorId || req.body.uploaderId || req.headers['x-user-id'];
    let uploaderNameResolved = req.body.creatorName || req.headers['x-user-name'];
    let uploaderEmailResolved = req.body.creatorEmail || req.body.uploaderEmail || req.headers['x-user-email'];

    if ((!uploaderNameResolved || uploaderNameResolved === 'System Administrator') && uploaderUid) {
      const foundUser = dbUsersStore.find(
        (u) => String(u.id).toLowerCase() === String(uploaderUid).toLowerCase() || (u.email && u.email.toLowerCase() === String(uploaderUid).toLowerCase())
      );
      if (foundUser) {
        uploaderNameResolved = foundUser.fullName;
        uploaderEmailResolved = foundUser.email;
      }
    }

    // 💡 Step 2: Clean and string-to-integer conversion safeguards for user IDs
    const cleanAssignedToId = assignedTelecaller ? (parseInt(String(assignedTelecaller.id).replace(/\D/g, ''), 10) || null) : null;
    const cleanCreatorId = parseInt(String(uploaderUid || '1').replace(/\D/g, ''), 10) || 1;

    const newLead = {
      id: `lead_${Math.random().toString(36).substring(2, 10)}`,
      firstName,
      lastName,
      email,
      phone,
      source: String(raw.source || raw['Source'] || raw['source'] || raw['Lead Source'] || source || 'Excel Import').trim(),
      campaignId: campaignId || raw.campaignId || 'cmp_default',
      campaignName: targetCampName,
      adId: raw.adId || '',
      status: assignedTelecaller ? 'ASSIGNED' : 'NEW',
      assignedTo: assignedTelecaller ? assignedTelecaller.id : null,
      assigneeName: assignedTelecaller ? assignedTelecaller.fullName : 'Unassigned',
      creatorId: uploaderUid || '1',
      creatorEmail: uploaderEmailResolved || req.body.creatorEmail || 'admin@markops.io',
      creatorName: req.body.creatorName || uploaderNameResolved || 'System Administrator',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      
      // Hidden properties bound strictly for safe MySQL transaction queries:
      _mysqlCampaignId: mysqlCampaignId,
      _mysqlAssignedTo: cleanAssignedToId,
      _mysqlCreatorId: cleanCreatorId
    };

    if (assignedTelecaller) {
      allocationSummary[assignedTelecaller.id].count++;
    }

    dbLeadsStore.unshift(newLead);
    createdLeads.push(newLead);
  }

  if (dbPool) {
    try {
      for (const l of createdLeads) {
        // 💡 Step 3: Pushed validated numerical column fields into the SQL bindings
        await dbPool.query(
          `INSERT INTO leads (first_name, last_name, email, phone, source, status, assigned_to, creator_id, creator_name, creator_email, campaign_id, campaign_name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
          [
            l.firstName, 
            l.lastName, 
            l.email, 
            l.phone, 
            l.source, 
            l.status, 
            l._mysqlAssignedTo, // Clean integer/null reference
            l._mysqlCreatorId,  // Clean integer user reference
            l.creatorName, 
            l.creatorEmail, 
            l._mysqlCampaignId, // 🟢 Verified integer reference instead of 'cmp_default'
            l.campaignName
          ]
        );
      }
    } catch (e) {
      console.log('[MySQL Notice] Batch save leads to database failed:', e?.message || e);
    }
  }

  // 3. Emit Realtime Events & Record Audit Log
  emitRealtimeEvent('leads:batch_imported', { total: createdLeads.length, allocationSummary });

  const creator = req.body.creatorName || req.body.uploaderEmail || 'System Administrator';
  const pkg = req.body.packageName || campaignName || 'CURRENT AFFAIRS AUGUST -2026';
  const prod = req.body.productName || (pkg.toLowerCase().includes('class') ? 'Classmate' : (pkg.toLowerCase().includes('jesus') ? 'Jesus Messenger' : 'Careermate'));

  Object.values(allocationSummary).forEach((summary) => {
    if (summary && summary.id && summary.count > 0) {
      const msg = `Assigned by: ${creator} -> Product: ${prod} -> Package: ${pkg} -> Total Leads: ${summary.count}`;
      createNotificationForTelecaller(
        summary.id,
        `New Leads Assigned (${summary.count} Leads)`,
        msg
      );
    }
  });

  await recordAuditLog(dbPool, {
    actorId: uploaderId || req.headers['x-user-id'] || 'usr_digital_01',
    actorEmail: uploaderEmail || 'digital@markops.io',
    action: 'LEADS_EXCEL_BATCH_UPLOAD',
    entityType: 'LeadBatch',
    entityId: `batch_${Date.now()}`,
    newState: { totalUploaded: createdLeads.length, telecallersCount: telecallers.length, allocationSummary },
    ipAddress: req.ip || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
  });

  return res.status(201).json({
    success: true,
    message: `Successfully uploaded ${createdLeads.length} leads and assigned equally among ${telecallers.length} active telecallers!`,
    totalUploaded: createdLeads.length,
    telecallersCount: telecallers.length,
    leadsPerTelecaller: telecallers.length > 0 ? Math.floor(createdLeads.length / telecallers.length) : 0,
    allocationSummary: Object.values(allocationSummary),
    leads: createdLeads,
  });
});

// GET /api/leads/telecalling-summary - Summary Dashboard metrics for Digital Marketing Head & Admin
router.get('/leads/telecalling-summary', async (req, res) => {
  const currentRole = String(req.user?.role || req.headers['x-user-role'] || '').toUpperCase();
  const currentUserId = req.user?.id ? String(req.user.id) : (req.headers['x-user-id'] ? String(req.headers['x-user-id']) : null);
  const isTelecallerRole = currentRole === 'TELECALLER';

  let allLeads = [];
  let allUsers = [];

  if (dbPool) {
    try {
      const [leadsRows] = await dbPool.query(`
        SELECT l.*, u.full_name as assignee_full_name, u.email as assignee_user_email
        FROM leads l
        LEFT JOIN users u ON l.assigned_to = u.id
      `);
      if (Array.isArray(leadsRows)) {
        allLeads = leadsRows.map((r) => ({
          id: r.id,
          status: r.status,
          assignedTo: r.assigned_to,
          assigneeName: r.assignee_full_name,
          assigneeEmail: r.assignee_user_email,
        }));
      }
      const [userRows] = await dbPool.query(`
        SELECT u.id, u.full_name as fullName, u.email, u.department, COALESCE(r.code, 'ADMINISTRATOR') as role, u.is_active as isActive
        FROM users u
        LEFT JOIN roles r ON u.role_id = r.id
      `);
      if (Array.isArray(userRows)) {
        allUsers = userRows.map((u) => ({
          id: u.id,
          fullName: u.fullName,
          email: u.email,
          department: u.department,
          role: u.role,
          isActive: Boolean(u.isActive),
        }));
      }
    } catch (e) {
      console.log('[telecalling-summary MySQL Error]:', e?.message || e);
    }
  }

  if (allLeads.length === 0) {
    allLeads = dbLeadsStore;
  }
  if (allUsers.length === 0) {
    allUsers = dbUsersStore;
  }

  // If requester is a telecaller, calculate summary only for their assigned leads
  const telecallerLeads = isTelecallerRole && currentUserId
    ? allLeads.filter((l) => String(l.assignedTo || l.assigned_to) === currentUserId)
    : allLeads;

  const totalLeads = telecallerLeads.length;
  const assignedLeads = telecallerLeads.filter((l) => l.assignedTo || l.assigned_to).length;
  const unassignedLeads = totalLeads - assignedLeads;

  const statusBreakdown = {
    NEW: 0,
    ASSIGNED: 0,
    CONTACTED: 0,
    INTERESTED: 0,
    NOT_INTERESTED: 0,
    QUALIFIED: 0,
    CONVERTED: 0,
    LOST: 0,
  };

  telecallerLeads.forEach((l) => {
    if (statusBreakdown[l.status] !== undefined) {
      statusBreakdown[l.status]++;
    }
  });

  // Telecallers performance summary (STRICTLY TELECALLER role)
  const telecallers = allUsers.filter((u) => u.role === 'TELECALLER' && u.isActive !== false);

  const telecallerMetrics = telecallers.map((tc) => {
    const assigned = allLeads.filter((l) => String(l.assignedTo || l.assigned_to) === String(tc.id));
    const calls = dbCallActivitiesStore.filter((c) => String(c.telecallerId) === String(tc.id));

    // 1 per 1 lead: count UNIQUE leads called
    const uniqueLeadsCalled = new Set(
      calls
        .map((c) => String(c.leadId || c.leadPhone || c.leadName || '').trim().toLowerCase())
        .filter((k) => !!k)
    );
    const uniqueAttendedLeads = new Set(
      attendedCalls
        .map((c) => String(c.leadId || c.leadPhone || c.leadName || '').trim().toLowerCase())
        .filter((k) => !!k)
    );
    const uniqueNotAttendedLeads = new Set(
      notAttendedCalls
        .map((c) => String(c.leadId || c.leadPhone || c.leadName || '').trim().toLowerCase())
        .filter((k) => !!k)
    );
    const uniqueInterestedLeads = new Set(
      interestedCalls
        .map((c) => String(c.leadId || c.leadPhone || c.leadName || '').trim().toLowerCase())
        .filter((k) => !!k)
    );
    const uniqueNotInterestedLeads = new Set(
      notInterestedCalls
        .map((c) => String(c.leadId || c.leadPhone || c.leadName || '').trim().toLowerCase())
        .filter((k) => !!k)
    );

    const totalDurationSeconds = calls.reduce((acc, c) => acc + (Number(c.durationSeconds) || 0), 0);
    const avgDurationSeconds = calls.length > 0 ? Math.round(totalDurationSeconds / calls.length) : 0;

    return {
      id: tc.id,
      fullName: tc.fullName,
      email: tc.email,
      department: tc.department || 'Telecalling Sales',
      assignedLeadsCount: assigned.length,
      callsLoggedCount: uniqueLeadsCalled.size,
      attendedCount: uniqueAttendedLeads.size,
      notAttendedCount: uniqueNotAttendedLeads.size,
      interestedCount: uniqueInterestedLeads.size,
      notInterestedCount: uniqueNotInterestedLeads.size,
      totalDurationSeconds,
      avgDurationSeconds,
      conversionRate: assigned.length > 0 ? Math.round((uniqueInterestedLeads.size / assigned.length) * 100) : 0,
    };
  });

  return res.json({
    totalLeads,
    assignedLeads,
    unassignedLeads,
    totalCallsLogged: dbCallActivitiesStore.length,
    statusBreakdown,
    telecallerMetrics,
  });
});

// GET /api/telecaller-targets/common
router.get('/telecaller-targets/common', (req, res) => {
  return res.json(dbCommonTargetStore);
});

// POST /api/telecaller-targets/common
router.post('/telecaller-targets/common', (req, res) => {
  const { dailyCallsTarget, dailyInterestedTarget, dailyDurationTargetSeconds, updatedBy } = req.body;
  if (dailyCallsTarget !== undefined) {
    dbCommonTargetStore.dailyCallsTarget = Number(dailyCallsTarget) || 30;
  }
  if (dailyInterestedTarget !== undefined) {
    dbCommonTargetStore.dailyInterestedTarget = Number(dailyInterestedTarget) || 5;
  }
  if (dailyDurationTargetSeconds !== undefined) {
    dbCommonTargetStore.dailyDurationTargetSeconds = Number(dailyDurationTargetSeconds) || 3600;
  }
  dbCommonTargetStore.updatedBy = updatedBy || 'Marketing Manager';
  dbCommonTargetStore.updatedAt = new Date().toISOString();

  emitRealtimeEvent('telecaller_target:updated', dbCommonTargetStore);
  return res.json(dbCommonTargetStore);
});

// GET /api/telecaller-targets
router.get('/telecaller-targets', (req, res) => {
  return res.json({
    common: dbCommonTargetStore,
    targets: dbTelecallerTargetsStore || [],
  });
});

// POST /api/telecaller-targets/:telecallerId (Set target for single specific telecaller)
router.post('/telecaller-targets/:telecallerId', (req, res) => {
  const { telecallerId } = req.params;
  const { dailyCallsTarget, dailyInterestedTarget, dailyDurationTargetSeconds, updatedBy, telecallerName, telecallerEmail } = req.body;

  if (!Array.isArray(dbTelecallerTargetsStore)) {
    dbTelecallerTargetsStore = [];
  }

  let target = dbTelecallerTargetsStore.find((t) => String(t.telecallerId) === String(telecallerId));
  if (!target) {
    target = {
      id: `tgt_${telecallerId}_${Date.now()}`,
      telecallerId: String(telecallerId),
      telecallerName: telecallerName || 'Telecaller',
      telecallerEmail: telecallerEmail || '',
      dailyCallsTarget: Number(dailyCallsTarget) || 30,
      dailyInterestedTarget: Number(dailyInterestedTarget) || 5,
      dailyDurationTargetSeconds: (Number(dailyCallsTarget) || 30) * 120,
      updatedBy: updatedBy || 'Marketing Manager',
      updatedAt: new Date().toISOString(),
    };
    dbTelecallerTargetsStore.push(target);
  } else {
    if (dailyCallsTarget !== undefined) target.dailyCallsTarget = Number(dailyCallsTarget) || 30;
    if (dailyInterestedTarget !== undefined) target.dailyInterestedTarget = Number(dailyInterestedTarget) || 5;
    if (dailyDurationTargetSeconds !== undefined) target.dailyDurationTargetSeconds = Number(dailyDurationTargetSeconds) || (target.dailyCallsTarget * 120);
    if (telecallerName) target.telecallerName = telecallerName;
    if (telecallerEmail) target.telecallerEmail = telecallerEmail;
    target.updatedBy = updatedBy || 'Marketing Manager';
    target.updatedAt = new Date().toISOString();
  }

  emitRealtimeEvent('telecaller_target:user_updated', target);
  return res.json(target);
});

module.exports = router;


