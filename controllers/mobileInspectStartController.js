const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const MobileInspectConfig = require('../models/MobileInspectConfig');
const InferenceJob = require('../models/InferenceJob');
const { inferenceQueue } = require('../queue');
const storageAdapter = require('../services/storageAdapter');
const auditService = require('../services/auditService');
const { validateWorkspaceAccess, canAccessAllWorkspaces } = require('../utils/workspaceScoping');
const { resolveModelCheckpointPath } = require('../services/resolveModelCheckpoint');

/**
 * POST /api/mobile-inspect
 * multipart: regionName, project, files[]
 * Uses the pinned YOLO_SEG model for company + project.
 */
const startMobileInspect = async (req, res) => {
  try {
    const regionName = String(req.body.regionName || '').trim();
    const surveyName = String(req.body.surveyName || '').trim();
    const project = String(req.body.project || '').trim();
    const company = String(req.user?.company || '').trim();
    const uploadedImages = Array.isArray(req.files) ? req.files : [];

    if (!regionName) {
      return res.status(400).json({
        error: 'Missing required field: regionName',
        message: 'Enter a region name before uploading photos.',
      });
    }

    if (!surveyName) {
      return res.status(400).json({
        error: 'Missing required field: surveyName',
        message: 'Start or open a survey first, then inspect a ship part.',
      });
    }

    if (!project) {
      return res.status(400).json({
        error: 'Missing required field: project',
      });
    }

    if (!company) {
      return res.status(400).json({
        error: 'Missing company on user',
        message: 'Your account has no workspace company. Log in again.',
      });
    }

    if (uploadedImages.length === 0) {
      return res.status(400).json({
        error: 'No files uploaded',
        message: 'At least one jpg/png image is required.',
      });
    }

    if (!canAccessAllWorkspaces(req.user)) {
      const access = validateWorkspaceAccess(req.user, company);
      if (!access.allowed) {
        return res.status(403).json({
          error: 'Permission denied',
          message: access.error || 'You do not have access to this workspace',
        });
      }
    }

    const pin = await MobileInspectConfig.findOne({ company, project }).populate('modelId');
    if (!pin || !pin.modelId) {
      return res.status(400).json({
        error: 'No mobile inspect model pinned',
        message: 'Pin a YOLO_SEG model in Workspace Settings → Mobile Inspect.',
      });
    }

    const model = pin.modelId;
    if (model.modelType !== 'YOLO_SEG') {
      return res.status(400).json({
        error: 'Pinned model must be YOLO_SEG',
        modelType: model.modelType,
      });
    }

    const checkpointPath = resolveModelCheckpointPath(model);
    if (!checkpointPath || !fs.existsSync(checkpointPath)) {
      return res.status(404).json({
        error: 'Pinned model checkpoint file not found',
        modelId: model.modelId,
      });
    }

    const conf =
      typeof pin.confidenceThreshold === 'number' && Number.isFinite(pin.confidenceThreshold)
        ? pin.confidenceThreshold
        : 0.25;

    const tempInferenceDir = path.join(
      process.cwd(),
      'uploads',
      'inference-temp',
      `insp_${Date.now()}_${uuidv4().substring(0, 8)}`
    );
    await storageAdapter.ensureDir(tempInferenceDir);

    for (const file of uploadedImages) {
      const destPath = path.join(tempInferenceDir, file.originalname);
      try {
        await fs.promises.rename(file.path, destPath);
      } catch {
        await fs.promises.copyFile(file.path, destPath);
        await fs.promises.unlink(file.path);
      }
    }

    const inferenceId = `inf_${Date.now()}_${uuidv4().substring(0, 8)}`;

    const inferenceJob = new InferenceJob({
      inferenceId,
      modelId: model._id,
      company: model.company,
      project: model.project,
      sourceType: 'custom_folder',
      customFolderPath: tempInferenceDir,
      regionName,
      surveyName,
      status: 'queued',
      createdBy: req.user ? req.user.id : null,
      progress: {
        totalImages: uploadedImages.length,
        processedImages: 0,
        progressPercent: 0,
      },
    });
    await inferenceJob.save();

    await inferenceQueue.add(
      {
        inferenceId,
        modelId: model._id.toString(),
        company: model.company,
        project: model.project,
        sourceType: 'custom_folder',
        customFolderPath: tempInferenceDir,
        confidenceThreshold: conf,
        regionName,
        surveyName,
      },
      {
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
      }
    );

    await auditService.logAction({
      action: 'execute',
      resourceType: 'inference',
      resourceId: inferenceId,
      details: {
        company: model.company,
        project: model.project,
        projectName: model.project,
        modelId: model._id.toString(),
        sourceType: 'custom_folder',
        regionName,
        surveyName,
        totalImages: uploadedImages.length,
        mobileInspect: true,
      },
      req,
    });

    return res.status(202).json({
      inferenceId: inferenceJob.inferenceId,
      status: inferenceJob.status,
      regionName,
      surveyName,
      modelVersion: model.modelVersion,
      totalImages: uploadedImages.length,
      message: 'Inspect job queued',
    });
  } catch (error) {
    console.error('[mobile-inspect] start error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
};

module.exports = { startMobileInspect };
