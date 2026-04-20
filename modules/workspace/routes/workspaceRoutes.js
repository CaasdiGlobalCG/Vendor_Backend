import express from 'express';
import multer from 'multer';
import {
  createQuotation,
  getQuotations,
  getQuotationsStats,
  updateQuotation,
  updateQuotationStatus,
  sendQuotationToPM,
  updateQuotationPdfUrl,
  savePmPOFile,
  createInvoice,
  updateInvoice,
  getInvoices,
  sendInvoiceToPM,
  createItem,
  getItems,
  updateItem,
  deleteItem,
  createCustomer,
  getCustomers,
  getCustomerById,
  updateCustomer,
  searchCustomers,
  createPurchaseOrderFromQuote,
  reviewPurchaseOrder,
  sendPurchaseOrderToVendor,
  vendorRespondToPurchaseOrder,
  pmApproveVendorResponse,
  sendPurchaseOrderToFinance,
  financeApprovePurchaseOrder,
  getPOStatusByQuotation,
  updateProgress,
  approveProgress,
  rejectProgress,
  clientApproveProgress,
  clientRejectProgress,
  submitProjectCompletion,
  approveProjectComplete,
  rejectProjectComplete,
  clientApproveProjectComplete,
  clientRejectProjectComplete
} from '../controllers/workspaceController.js';
import { getWorkspaceInvoices, getInvoiceStats, updateWorkspaceInvoiceStatus } from '../controllers/workspaceInvoicesController.js';
import { getWorkspaceCreditNotes, getWorkspaceCreditNoteById, getCreditNoteStats, updateCreditNoteRequestStatus } from '../controllers/workspaceCreditNotesController.js';
import { getWorkspacePurchaseOrders, vendorApprovePurchaseOrder } from '../controllers/workspacePurchaseOrdersController.js';
import { getWorkspaceSubscriptions, getSubscriptionStats, createSubscription, updateSubscription, deleteSubscription, pauseSubscription, resumeSubscription, getSubscriptionHistory, generateSubscriptionInvoice, bulkPauseSubscriptions, bulkResumeSubscriptions } from '../controllers/workspaceSubscriptionsController.js';
import purchaseRequisitionsRouter from './purchaseRequisitionsRoutes.js';
import procurementRequestsRouter from './procurementRequestsRoutes.js';
import procurementQueriesRouter from './procurementQueriesRoutes.js';
import { getRevenueForecasting, getCohortAnalysis } from '../controllers/subscriptionAnalyticsController.js';
import { authenticateUser, requireVendor, requirePM, requireClient, checkVendorAccess } from '../../../middleware/authMiddleware.js';

const router = express.Router();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Apply authentication middleware to all routes
router.use(authenticateUser);

// PM-only routes (before requireVendor middleware)
/**
 * @route   POST /api/workspace/approve-progress
 * @desc    Approve progress submission (PM only)
 * @access  Private
 */
router.post('/approve-progress', requirePM, approveProgress);

/**
 * @route   POST /api/workspace/reject-progress
 * @desc    Reject progress submission (PM only)
 * @access  Private
 */
router.post('/reject-progress', requirePM, rejectProgress);

// Client-only routes (before requireVendor middleware)
/**
 * @route   POST /api/workspace/client-approve-progress
 * @desc    Approve progress submission (Client only)
 * @access  Private
 */
router.post('/client-approve-progress', authenticateUser, clientApproveProgress);

/**
 * @route   POST /api/workspace/client-reject-progress
 * @desc    Reject progress submission (Client only)
 * @access  Private
 */
router.post('/client-reject-progress', authenticateUser, clientRejectProgress);

/**
 * @route   POST /api/workspace/approve-project-complete
 * @desc    Approve project completion (PM only)
 * @access  Private
 */
router.post('/approve-project-complete', requirePM, approveProjectComplete);

/**
 * @route   POST /api/workspace/reject-project-complete
 * @desc    Reject project completion (PM only)
 * @access  Private
 */
router.post('/reject-project-complete', requirePM, rejectProjectComplete);

/**
 * @route   POST /api/workspace/client-approve-project-complete
 * @desc    Approve project completion (Client only)
 * @access  Private
 */
router.post('/client-approve-project-complete', authenticateUser, clientApproveProjectComplete);

/**
 * @route   POST /api/workspace/client-reject-project-complete
 * @desc    Reject project completion (Client only)
 * @access  Private
 */
router.post('/client-reject-project-complete', authenticateUser, clientRejectProjectComplete);

// Apply vendor middleware to remaining routes
router.use(requireVendor);

// Mount purchase requisitions routes
router.use('/purchase-requisitions', purchaseRequisitionsRouter);

// Mount procurement requests routes
router.use('/procurement-requests', procurementRequestsRouter);

// Mount workspace procurement query chat routes
router.use('/procurement-queries', procurementQueriesRouter);

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
 * @route   GET /api/workspace/quotations/:quotationId/po-status
 * @desc    Get PO status for a specific quotation (Client can see their own, others can see their POs)
 * @access  Private
 */
router.get('/quotations/:quotationId/po-status', authenticateUser, getPOStatusByQuotation);

/**
 * @route   POST /api/workspace/quotations/:quotationId/pm-po-file
 * @desc    Save PM-modified PO file (with commission removed and rates adjusted)
 * @access  Private (PM only)
 */
router.post('/quotations/:quotationId/pm-po-file', authenticateUser, requirePM, savePmPOFile);

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
 * @route   PUT /api/workspace/invoices/:invoiceId
 * @desc    Update an existing invoice (Vendor only)
 * @access  Private
 */
router.put('/invoices/:invoiceId', authenticateUser, requireVendor, updateInvoice);

/**
 * @route   GET /api/workspace/invoices
 * @desc    Get invoices based on user role (Vendor sees own, PM sees all)
 * @access  Private
 */
router.get('/invoices', authenticateUser, getWorkspaceInvoices);

/**
 * @route   PUT /api/workspace/invoices/:invoiceId/send-to-pm
 * @desc    Send invoice to PM for review (Vendor only)
 * @access  Private
 */
router.put('/invoices/:invoiceId/send-to-pm', authenticateUser, requireVendor, sendInvoiceToPM);

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
router.post('/purchase-orders', requireVendor, createPurchaseOrderFromQuote);

/**
 * @route   GET /api/workspace/purchase-orders
 * @desc    Get purchase orders based on user role (Vendor sees own, PM sees all)
 * @access  Private
 */
router.get('/purchase-orders', getWorkspacePurchaseOrders);

/**
 * @route   POST /api/workspace/purchase-orders/:poId/vendor-approve
 * @desc    Vendor approves a PO from PM and sends to PM for further review
 * @access  Private (Vendor only)
 */
router.post('/purchase-orders/:poId/vendor-approve', vendorApprovePurchaseOrder);

/**
 * @route   GET /api/workspace/purchase-orders/:poId/review
 * @desc    PM reviews PO details with commission breakdown
 * @access  Private (PM only)
 */
router.get('/purchase-orders/:poId/review', requirePM, reviewPurchaseOrder);

/**
 * @route   PUT /api/workspace/purchase-orders/:poId/send-to-vendor
 * @desc    PM removes commission and sends PO to vendor
 * @access  Private (PM only)
 */
router.put('/purchase-orders/:poId/send-to-vendor', authenticateUser, requirePM, sendPurchaseOrderToVendor);

/**
 * @route   PATCH /api/workspace/purchase-orders/:poId/vendor-response
 * @desc    Vendor accepts or rejects PO
 * @access  Private (Vendor only)
 */
router.patch('/purchase-orders/:poId/vendor-response', authenticateUser, requireVendor, vendorRespondToPurchaseOrder);

/**
 * @route   PUT /api/workspace/purchase-orders/:poId/pm-approve-vendor-response
 * @desc    PM approves vendor response and readies for finance
 * @access  Private (PM only)
 */
router.put('/purchase-orders/:poId/pm-approve-vendor-response', authenticateUser, requirePM, pmApproveVendorResponse);

/**
 * @route   PUT /api/workspace/purchase-orders/:poId/send-to-finance
 * @desc    PM sends approved PO to Finance
 * @access  Private (PM only)
 */
router.put('/purchase-orders/:poId/send-to-finance', authenticateUser, requirePM, sendPurchaseOrderToFinance);

/**
 * @route   PUT /api/workspace/purchase-orders/:poId/finance-approval
 * @desc    Finance adds commission and approves PO
 * @access  Private (Finance only)
 */
router.put('/purchase-orders/:poId/finance-approval', authenticateUser, financeApprovePurchaseOrder);

/**
 * ========================================
 * CREDIT NOTES ROUTES
 * ========================================
 */

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
 * @route   PATCH /api/workspace/credit-notes/:creditNoteId/status
 * @desc    Vendor updates status of a credit note request (acknowledge/process/issue/reject)
 * @access  Private (Vendor)
 */
router.patch('/credit-notes/:creditNoteId/status', authenticateUser, updateCreditNoteRequestStatus);

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

/**
 * @route   POST /api/workspace/update-progress
 * @desc    Update project progress (Vendor only)
 * @access  Private
 */
router.post('/update-progress', authenticateUser, requireVendor, upload.single('proofOfCompletion'), updateProgress);

/**
 * @route   POST /api/workspace/project-completion
 * @desc    Submit project completion request (Vendor only)
 * @access  Private
 */
router.post('/project-completion', authenticateUser, requireVendor, upload.single('completionFiles'), submitProjectCompletion);

/**
 * @route   GET /api/workspace/subscriptions/analytics/forecast
 * @desc    Get 12-month revenue forecast based on subscriptions (Vendor only)
 * @access  Private
 */
router.get('/subscriptions/analytics/forecast', authenticateUser, requireVendor, getRevenueForecasting);

/**
 * @route   GET /api/workspace/subscriptions/analytics/cohorts
 * @desc    Get cohort analysis of subscriptions by creation month (Vendor only)
 * @access  Private
 */
router.get('/subscriptions/analytics/cohorts', authenticateUser, requireVendor, getCohortAnalysis);

export default router;
