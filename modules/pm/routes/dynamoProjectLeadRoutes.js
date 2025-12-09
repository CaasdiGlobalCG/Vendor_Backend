import express from 'express';
import * as DynamoProjectLead from '../models/DynamoProjectLead.js';

const router = express.Router();

// Create a new project lead
router.post('/', async (req, res) => {
  try {
    const leadData = req.body;
    const newLead = await DynamoProjectLead.createProjectLead(leadData);
    res.status(201).json(newLead);
  } catch (error) {
    console.error('Error creating project lead:', error);
    res.status(500).json({ message: 'Failed to create project lead', error: error.message });
  }
});

// Get all project leads
router.get('/', async (req, res) => {
  try {
    const leads = await DynamoProjectLead.getAllProjectLeads();
    res.json(leads);
  } catch (error) {
    console.error('Error getting all project leads:', error);
    res.status(500).json({ message: 'Failed to get project leads', error: error.message });
  }
});

// Get a project lead by ID
router.get('/:id', async (req, res) => {
  try {
    const lead = await DynamoProjectLead.getProjectLeadById(req.params.id);
    if (!lead) {
      return res.status(404).json({ message: 'Project lead not found' });
    }
    res.json(lead);
  } catch (error) {
    console.error('Error getting project lead by ID:', error);
    res.status(500).json({ message: 'Failed to get project lead', error: error.message });
  }
});

// Get project leads by vendor ID
router.get('/vendor/:vendorId', async (req, res) => {
  try {
    const leads = await DynamoProjectLead.getProjectLeadsByVendorId(req.params.vendorId);
    res.json(leads);
  } catch (error) {
    console.error('Error getting project leads by vendor ID:', error);
    res.status(500).json({ message: 'Failed to get project leads for vendor', error: error.message });
  }
});

// Update a project lead
router.put('/:id', async (req, res) => {
  try {
    const leadData = req.body;
    const updatedLead = await DynamoProjectLead.updateProjectLead(req.params.id, leadData);
    res.json(updatedLead);
  } catch (error) {
    console.error('Error updating project lead:', error);
    res.status(500).json({ message: 'Failed to update project lead', error: error.message });
  }
});

// Delete a project lead
router.delete('/:id', async (req, res) => {
  try {
    await DynamoProjectLead.deleteProjectLead(req.params.id);
    res.json({ message: 'Project lead deleted successfully' });
  } catch (error) {
    console.error('Error deleting project lead:', error);
    res.status(500).json({ message: 'Failed to delete project lead', error: error.message });
  }
});

export default router;