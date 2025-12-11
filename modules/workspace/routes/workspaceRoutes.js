import express from 'express';
import {
  createQuotation,
  getQuotations,
  getQuotationsStats,
  updateQuotation,
  updateQuotationStatus,
  sendQuotationToPM,
  updateQuotationPdfUrl,
  createInvoice,
  getInvoices,
  createCreditNote,
  createItem,
  getItems,
  updateItem,
  deleteItem,
  createCustomer,
  getCustomers,
  getCustomerById,
  updateCustomer,
  searchCustomers,
  createPurchaseOrderFromQuote
} from '../controllers/workspaceController.js';
import { getWorkspaceInvoices, getInvoiceStats, updateWorkspaceInvoiceStatus } from '../controllers/workspaceInvoicesController.js';
import { getWorkspaceCreditNotes, getWorkspaceCreditNoteById, getCreditNoteStats } from '../controllers/workspaceCreditNotesController.js';
import { getWorkspacePurchaseOrders } from '../controllers/workspacePurchaseOrdersController.js';
import { getWorkspaceSubscriptions, getSubscriptionStats, createSubscription, updateSubscription, deleteSubscription, pauseSubscription, resumeSubscription, getSubscriptionHistory, generateSubscriptionInvoice, bulkPauseSubscriptions, bulkResumeSubscriptions } from '../controllers/workspaceSubscriptionsController.js';
import purchaseRequisitionsRouter from './purchaseRequisitionsRoutes.js';
import procurementRequestsRouter from './procurementRequestsRoutes.js';
import { getRevenueForecasting, getCohortAnalysis } from '../controllers/subscriptionAnalyticsController.js';
import { authenticateUser, requireVendor, requirePM, checkVendorAccess } from '../../../middleware/authMiddleware.js';

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authenticateUser);
router.use(requireVendor);

// Mount purchase requisitions routes
router.use('/purchase-requisitions', purchaseRequisitionsRouter);

// Mount procurement requests routes
router.use('/procurement-requests', procurementRequestsRouter);

/**
 * ========================================
 * QUOTATIONS ROUTES
 * ========================================
 */

/**
 * @route   POST /api/workspace/quotations
 * @desc    Create a new quotation (Vendor only)
 * @access  Private
 */
router.post('/quotations', authenticateUser, requireVendor, createQuotation);

/**
 * @route   GET /api/workspace/quotations
 * @desc    Get quotations based on user role (Vendor sees own, PM sees all)
 * @access  Private
 */
router.get('/quotations', authenticateUser, getQuotations);

/**
 * @route   GET /api/workspace/quotations/stats
 * @desc    Get quotation statistics based on user role
 * @access  Private
 */
router.get('/quotations/stats', authenticateUser, getQuotationsStats);

/**
 * @route   PUT /api/workspace/quotations/:quotationId
 * @desc    Update quotation (Vendor only)
 * @access  Private
 */
router.put('/quotations/:quotationId', authenticateUser, requireVendor, updateQuotation);

/**
 * @route   PATCH /api/workspace/quotations/:quotationId
 * @desc    Update quotation PDF URL (Vendor only, after styled PDF upload)
 * @access  Private
 */
router.patch('/quotations/:quotationId', authenticateUser, requireVendor, updateQuotationPdfUrl);

/**
 * @route   PUT /api/workspace/quotations/:quotationId/status
 * @desc    Update quotation status (PM approval only)
 * @access  Private
 */
router.put('/quotations/:quotationId/status', authenticateUser, requirePM, updateQuotationStatus);

/**
 * @route   PUT /api/workspace/quotations/:quotationId/send-to-pm
 * @desc    Send quotation to PM for review (Vendor only)
 * @access  Private
 */
router.put('/quotations/:quotationId/send-to-pm', authenticateUser, requireVendor, sendQuotationToPM);

/**
 * ========================================
 * INVOICES ROUTES
 * ========================================
 */

/**
 * @route   POST /api/workspace/invoices
 * @desc    Create a new invoice (Vendor only)
 * @access  Private
 */
router.post('/invoices', authenticateUser, requireVendor, createInvoice);

/**
 * @route   GET /api/workspace/invoices
 * @desc    Get invoices based on user role (Vendor sees own, PM sees all)
 * @access  Private
 */
router.get('/invoices', authenticateUser, getWorkspaceInvoices);

/**
 * @route   PUT /api/workspace/invoices/:invoiceId/status
 * @desc    Update invoice status (Vendor only)
 * @access  Private
 */
router.put('/invoices/:invoiceId/status', authenticateUser, requireVendor, updateWorkspaceInvoiceStatus);

/**
 * @route   GET /api/workspace/invoices/stats
 * @desc    Get invoice statistics based on user role
 * @access  Private
 */
router.get('/invoices/stats', authenticateUser, getInvoiceStats);

/**
 * ========================================
 * PURCHASE ORDERS ROUTES
 * ========================================
 */

/**
 * @route   POST /api/workspace/purchase-orders
 * @desc    Create a new purchase order from a quotation (Vendor only)
 * @access  Private
 */
router.post('/purchase-orders', authenticateUser, requireVendor, createPurchaseOrderFromQuote);

/**
 * @route   GET /api/workspace/purchase-orders
 * @desc    Get purchase orders based on user role (Vendor sees own, PM sees all)
 * @access  Private
 */
router.get('/purchase-orders', authenticateUser, getWorkspacePurchaseOrders);

/**
 * ========================================
 * CREDIT NOTES ROUTES
 * ========================================
 */

/**
 * @route   POST /api/workspace/credit-notes
 * @desc    Create a new credit note (Vendor only)
 * @access  Private
 */
router.post('/credit-notes', authenticateUser, requireVendor, createCreditNote);

/**
 * @route   GET /api/workspace/credit-notes
 * @desc    Get credit notes based on user role (Vendor sees own, PM sees all)
 * @access  Private
 */
router.get('/credit-notes', authenticateUser, getWorkspaceCreditNotes);

/**
 * @route   GET /api/workspace/credit-notes/:creditNoteId
 * @desc    Get a specific credit note by ID
 * @access  Private
 */
router.get('/credit-notes/:creditNoteId', authenticateUser, getWorkspaceCreditNoteById);

/**
 * @route   GET /api/workspace/credit-notes/stats
 * @desc    Get credit note statistics based on user role
 * @access  Private
 */
router.get('/credit-notes/stats', authenticateUser, getCreditNoteStats);

/**
 * ========================================
 * ITEMS ROUTES
 * ========================================
 */

/**
 * @route   POST /api/workspace/items
 * @desc    Create a new item (Vendor only)
 * @access  Private
 */
router.post('/items', authenticateUser, requireVendor, createItem);

/**
 * @route   GET /api/workspace/items
 * @desc    Get items based on user role (Vendor sees own, PM sees all)
 * @access  Private
 */
router.get('/items', authenticateUser, getItems);

/**
 * @route   PUT /api/workspace/items/:itemId
 * @desc    Update an item (Vendor only)
 * @access  Private
 */
router.put('/items/:itemId', authenticateUser, requireVendor, updateItem);

/**
 * @route   DELETE /api/workspace/items/:itemId
 * @desc    Delete an item (Vendor only)
 * @access  Private
 */
router.delete('/items/:itemId', authenticateUser, requireVendor, deleteItem);

/**
 * ========================================
 * CUSTOMERS ROUTES
 * ========================================
 */

/**
 * @route   POST /api/workspace/customers
 * @desc    Create a new customer (Vendor only)
 * @access  Private
 */
router.post('/customers', authenticateUser, requireVendor, createCustomer);

/**
 * @route   GET /api/workspace/customers
 * @desc    Get customers based on user role (Vendor sees own, PM sees all)
 * @access  Private
 */
router.get('/customers', authenticateUser, getCustomers);

/**
 * @route   GET /api/workspace/customers/:customerId
 * @desc    Get customer by ID based on user role
 * @access  Private
 */
router.get('/customers/:customerId', authenticateUser, getCustomerById);

/**
 * @route   PUT /api/workspace/customers/:customerId
 * @desc    Update customer (Vendor only)
 * @access  Private
 */
router.put('/customers/:customerId', authenticateUser, requireVendor, updateCustomer);

/**
 * @route   GET /api/workspace/customers/search
 * @desc    Search customers based on user role
 * @access  Private
 */
router.get('/customers/search', authenticateUser, searchCustomers);

/**
 * ========================================
 * SUBSCRIPTIONS ROUTES
 * ========================================
 */

/**
 * @route   POST /api/workspace/subscriptions
 * @desc    Create a new subscription (Vendor only)
 * @access  Private
 */
router.post('/subscriptions', authenticateUser, requireVendor, createSubscription);

/**
 * @route   GET /api/workspace/subscriptions
 * @desc    Get subscriptions based on user role (Vendor sees own, PM sees all)
 * @access  Private
 */
router.get('/subscriptions', authenticateUser, getWorkspaceSubscriptions);

/**
 * @route   GET /api/workspace/subscriptions/stats
 * @desc    Get subscription statistics based on user role
 * @access  Private
 */
router.get('/subscriptions/stats', authenticateUser, getSubscriptionStats);

/**
 * @route   PUT /api/workspace/subscriptions/:subscriptionId
 * @desc    Update subscription (Vendor only)
 * @access  Private
 */
router.put('/subscriptions/:subscriptionId', authenticateUser, requireVendor, updateSubscription);

/**
 * @route   DELETE /api/workspace/subscriptions/:subscriptionId
 * @desc    Delete subscription (Vendor only)
 * @access  Private
 */
router.delete('/subscriptions/:subscriptionId', authenticateUser, requireVendor, deleteSubscription);

/**
 * @route   PUT /api/workspace/subscriptions/:subscriptionId/pause
 * @desc    Pause subscription (Vendor only)
 * @access  Private
 */
router.put('/subscriptions/:subscriptionId/pause', authenticateUser, requireVendor, pauseSubscription);

/**
 * @route   PUT /api/workspace/subscriptions/:subscriptionId/resume
 * @desc    Resume subscription (Vendor only)
 * @access  Private
 */
router.put('/subscriptions/:subscriptionId/resume', authenticateUser, requireVendor, resumeSubscription);

/**
 * @route   GET /api/workspace/subscriptions/:subscriptionId/history
 * @desc    Get subscription renewal history
 * @access  Private
 */
router.get('/subscriptions/:subscriptionId/history', authenticateUser, getSubscriptionHistory);

/**
 * @route   POST /api/workspace/subscriptions/:subscriptionId/generate-invoice
 * @desc    Generate invoice for subscription (Vendor only)
 * @access  Private
 */
router.post('/subscriptions/:subscriptionId/generate-invoice', authenticateUser, requireVendor, generateSubscriptionInvoice);

export default router;
