import express from 'express';
import { 
  getWorkspaceQuotes, 
  getWorkspaceQuoteById, 
  getWorkspaceQuotesStats 
} from '../controllers/workspaceQuotesController.js';

const router = express.Router();

/**
 * @route   GET /api/workspace/quotes
 * @desc    Get all quotes for a vendor from quotations_by_vendor table
 * @access  Private
 */
router.get('/', getWorkspaceQuotes);

/**
 * @route   GET /api/workspace/quotes/:quoteId
 * @desc    Get a specific quote by ID from quotations_by_vendor table
 * @access  Private
 */
router.get('/:quoteId', getWorkspaceQuoteById);

/**
 * @route   GET /api/workspace/quotes/stats/:vendorId
 * @desc    Get quotes statistics for a vendor
 * @access  Private
 */
router.get('/stats/:vendorId', getWorkspaceQuotesStats);

export default router;
