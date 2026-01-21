const express = require('express');
const router = express.Router();
const { getAuditLog } = require('../controllers/auditController');

/**
 * Audit Routes
 *
 * Read-only access to audit logs.
 */

// GET /api/audit/log
router.get('/log', getAuditLog);

module.exports = router;

