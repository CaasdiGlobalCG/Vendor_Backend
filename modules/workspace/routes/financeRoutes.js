import express from 'express';
import { getFinanceOverview } from '../controllers/financeOverviewController.js';
import { authenticateCognitoJwt } from '../../../middleware/cognitoJwtMiddleware.js';

const router = express.Router();

/**
 * @route   GET /api/finance/overview
 * @desc    Get comprehensive financial overview for vendor (workspace + sales + B2B)
 * @access  Private (Vendor only)
 */
router.get('/overview', authenticateCognitoJwt, getFinanceOverview);

export default router;
