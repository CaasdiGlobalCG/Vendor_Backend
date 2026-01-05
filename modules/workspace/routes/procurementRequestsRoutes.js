import express from 'express';
import {
  createProcurementRequest,
  getProcurementRequests,
  getProcurementRequestById,
  updateProcurementRequest
} from '../controllers/procurementRequestsController.js';
import { authenticateUser } from '../../../middleware/authMiddleware.js';

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authenticateUser);

/**
 * @swagger
 * /api/procurement-requests:
 *   post:
 *     summary: Create a new procurement request
 *     tags: [Procurement Requests]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - item
 *               - workspaceId
 *             properties:
 *               requestId:
 *                 type: string
 *                 description: Unique request ID (auto-generated if not provided)
 *               item:
 *                 type: string
 *                 description: Name of the item/material
 *               itemDescription:
 *                 type: string
 *                 description: Description of the item
 *               quantity:
 *                 type: number
 *                 description: Quantity requested
 *               priority:
 *                 type: string
 *                 enum: [low, medium, high]
 *                 description: Priority level
 *               workspaceId:
 *                 type: string
 *                 description: Workspace ID
 *               source:
 *                 type: string
 *                 default: workspace
 *                 description: Source of the request
 *               status:
 *                 type: string
 *                 default: Pending
 *                 description: Status of the request
 *     responses:
 *       201:
 *         description: Procurement request created successfully
 *       400:
 *         description: Bad request - missing required fields
 *       500:
 *         description: Internal server error
 */
router.post('/', createProcurementRequest);

/**
 * @swagger
 * /api/procurement-requests:
 *   get:
 *     summary: Get all procurement requests
 *     tags: [Procurement Requests]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: workspaceId
 *         schema:
 *           type: string
 *         description: Filter by workspace ID
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by status
 *       - in: query
 *         name: source
 *         schema:
 *           type: string
 *         description: Filter by source
 *     responses:
 *       200:
 *         description: List of procurement requests
 *       500:
 *         description: Internal server error
 */
router.get('/', getProcurementRequests);

/**
 * @swagger
 * /api/procurement-requests/{requestId}:
 *   get:
 *     summary: Get a single procurement request by ID
 *     tags: [Procurement Requests]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the procurement request
 *     responses:
 *       200:
 *         description: Procurement request details
 *       404:
 *         description: Procurement request not found
 *       500:
 *         description: Internal server error
 */
router.get('/:requestId', getProcurementRequestById);

/**
 * @swagger
 * /api/procurement-requests/{requestId}:
 *   put:
 *     summary: Update an existing procurement request
 *     tags: [Procurement Requests]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the procurement request to update
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               item:
 *                 type: string
 *                 description: Name of the item/material
 *               itemDescription:
 *                 type: string
 *                 description: Description of the item
 *               quantity:
 *                 type: number
 *                 description: Quantity requested
 *               priority:
 *                 type: string
 *                 enum: [low, medium, high]
 *                 description: Priority level
 *               status:
 *                 type: string
 *                 description: Status of the request
 *               sentOn:
 *                 type: string
 *                 description: Date the request was sent
 *               amount:
 *                 type: number
 *                 description: Amount for the request
 *               category:
 *                 type: string
 *                 description: Category of the request
 *               department:
 *                 type: string
 *                 description: Department
 *     responses:
 *       200:
 *         description: Procurement request updated successfully
 *       400:
 *         description: Bad request - missing required fields
 *       404:
 *         description: Procurement request not found
 *       500:
 *         description: Internal server error
 */
router.put('/:requestId', updateProcurementRequest);

export default router;


