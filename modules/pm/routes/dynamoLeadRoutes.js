import express from 'express';
import * as dynamoLeadController from '../controllers/dynamoLeadController.js';

const router = express.Router();

// Create a new lead
router.post('/project-leads', dynamoLeadController.createLead);

// Get all leads
router.get('/project-leads', dynamoLeadController.getAllLeads);

// Get lead by ID
router.get('/project-leads/:id', dynamoLeadController.getLeadById);

// Get leads by client ID
router.get('/project-leads/client/:clientId', dynamoLeadController.getLeadsByClientId);

// Get leads by vendor ID
router.get('/project-leads/vendor/:vendorId', dynamoLeadController.getLeadsByVendorId);

// Get leads by PM ID
router.get('/project-leads/pm/:pmId', dynamoLeadController.getLeadsByPmId);

// Update a lead
router.put('/project-leads/:id', dynamoLeadController.updateLead);

// Delete a lead
router.delete('/project-leads/:id', dynamoLeadController.deleteLead);

export default router;