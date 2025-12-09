import express from 'express';
import {
  createPurchaseRequisition,
  getPurchaseRequisitions,
  getPurchaseRequisitionById,
  updatePurchaseRequisition
} from '../controllers/purchaseRequisitionsController.js';
import { authenticateUser } from '../../../middleware/authMiddleware.js';

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authenticateUser);

/**
 * @swagger
 * /api/workspace/purchase-requisitions:
 *   post:
 *     summary: Create a new purchase requisition
 *     tags: [Purchase Requisitions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PurchaseRequisition'
 *     responses:
 *       201:
 *         description: Purchase requisition created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PurchaseRequisition'
 *       400:
 *         description: Bad request - missing required fields
 *       500:
 *         description: Internal server error
 */
router.post('/', createPurchaseRequisition);

/**
 * @swagger
 * /api/workspace/purchase-requisitions:
 *   get:
 *     summary: Get all purchase requisitions for a vendor
 *     tags: [Purchase Requisitions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: vendorId
 *         schema:
 *           type: string
 *         required: true
 *         description: ID of the vendor
 *       - in: query
 *         name: workspaceId
 *         schema:
 *           type: string
 *         description: Filter by workspace ID
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [draft, pending, approved, rejected, cancelled]
 *         description: Filter by status
 *     responses:
 *       200:
 *         description: List of purchase requisitions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PurchaseRequisition'
 *                 count:
 *                   type: number
 *                 message:
 *                   type: string
 *       400:
 *         description: Bad request - missing required fields
 *       500:
 *         description: Internal server error
 */
router.get('/', (req, res) => getPurchaseRequisitions(req, res));

/**
 * @swagger
 * /api/workspace/purchase-requisitions/{requisitionId}:
 *   get:
 *     summary: Get a single purchase requisition by ID
 *     tags: [Purchase Requisitions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: requisitionId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the purchase requisition to get
 *       - in: query
 *         name: vendorId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the vendor
 *     responses:
 *       200:
 *         description: Purchase requisition details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PurchaseRequisition'
 *       404:
 *         description: Purchase requisition not found
 *       500:
 *         description: Internal server error
 */
router.get('/:requisitionId', getPurchaseRequisitionById);

/**
 * @swagger
 * /api/workspace/purchase-requisitions/{requisitionId}:
 *   put:
 *     summary: Update a purchase requisition
 *     tags: [Purchase Requisitions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: requisitionId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the purchase requisition to update
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               vendorId:
 *                 type: string
 *                 description: ID of the vendor
 *               status:
 *                 type: string
 *                 enum: [draft, pending, approved, rejected, cancelled]
 *                 description: New status of the requisition
 *               notes:
 *                 type: string
 *                 description: Additional notes or comments
 *     responses:
 *       200:
 *         description: Purchase requisition updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PurchaseRequisition'
 *       400:
 *         description: Bad request - missing required fields
 *       404:
 *         description: Purchase requisition not found
 *       500:
 *         description: Internal server error
 */
router.put('/:requisitionId', updatePurchaseRequisition);

export default router;
