// ============================================================
// FILE: modules/ai/controllers/canvasBuilderController.js
// PURPOSE: POST /api/ai/canvas-builder — prompt → canvas spec.
// ============================================================

import { buildCanvasSpec } from '../services/canvasBuilderService.js';

export const handleBuildCanvas = async (req, res) => {
  try {
    const { prompt, context } = req.body || {};

    const cleanPrompt = String(prompt || '').trim();
    if (!cleanPrompt) {
      return res.status(400).json({ success: false, message: 'A description is required' });
    }
    if (cleanPrompt.length > 2000) {
      return res.status(400).json({ success: false, message: 'Description is too long (max 2000 characters)' });
    }

    const result = await buildCanvasSpec({ prompt: cleanPrompt, context: context || {} });

    return res.json({
      success: true,
      data: {
        spec: result.spec,
        warnings: result.warnings,
      },
    });
  } catch (error) {
    const status = error?.status || 502;
    console.error('❌ Canvas builder failed:', error?.message || error);
    return res.status(status).json({
      success: false,
      message: error?.message || 'Failed to generate canvas',
    });
  }
};
