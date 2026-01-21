const { getAuditLogs } = require('../services/auditService');

/**
 * Audit Controller
 *
 * Exposes read-only access to audit logs for admin/analytics views.
 * This does not affect existing flows.
 */

/**
 * GET /api/audit/log
 *
 * Query params (all optional):
 * - company
 * - project
 * - userId
 * - action
 * - resourceType
 * - startDate
 * - endDate
 * - page (default 1)
 * - limit (default 50)
 */
const getAuditLog = async (req, res) => {
  try {
    const {
      company,
      project,
      userId,
      action,
      resourceType,
      startDate,
      endDate,
      page,
      limit
    } = req.query;

    const result = await getAuditLogs({
      company,
      project,
      userId,
      action,
      resourceType,
      startDate,
      endDate,
      page,
      limit
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error('Error in getAuditLog:', error);
    return res.status(500).json({
      error: 'Failed to load audit log',
      message: error.message
    });
  }
};

module.exports = {
  getAuditLog
};

