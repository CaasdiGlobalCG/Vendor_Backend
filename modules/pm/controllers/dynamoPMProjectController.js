import * as DynamoPMProject from '../models/DynamoPMProject.js';

// Create a new PM project
export const createPMProject = async (req, res) => {
  try {
    const projectData = req.body;
    const project = await DynamoPMProject.createPMProject(projectData);
    
    console.log('✅ dynamoPMProjectController: PM project created successfully:', project.id);
    res.status(201).json(project);
  } catch (error) {
    console.error('❌ dynamoPMProjectController: Error creating PM project:', error);
    res.status(500).json({ message: 'Failed to create PM project', error: error.message });
  }
};

// Get all PM projects
export const getAllPMProjects = async (req, res) => {
  try {
    const projects = await DynamoPMProject.getAllPMProjects();
    res.status(200).json(projects);
  } catch (error) {
    console.error('❌ dynamoPMProjectController: Error getting all PM projects:', error);
    res.status(500).json({ message: 'Failed to get PM projects', error: error.message });
  }
};

// Get PM project by ID
export const getPMProjectById = async (req, res) => {
  try {
    const { id } = req.params;
    const project = await DynamoPMProject.getPMProjectById(id);
    
    if (!project) {
      return res.status(404).json({ message: 'PM project not found' });
    }
    
    res.status(200).json(project);
  } catch (error) {
    console.error('❌ dynamoPMProjectController: Error getting PM project by ID:', error);
    res.status(500).json({ message: 'Failed to get PM project', error: error.message });
  }
};

// Get PM projects by vendor ID
export const getPMProjectsByVendorId = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const projects = await DynamoPMProject.getPMProjectsByVendorId(vendorId);
    res.status(200).json(projects);
  } catch (error) {
    console.error('❌ dynamoPMProjectController: Error getting PM projects by vendor ID:', error);
    res.status(500).json({ message: 'Failed to get PM projects', error: error.message });
  }
};

// Get PM projects by client ID
export const getPMProjectsByClientId = async (req, res) => {
  try {
    const { clientId } = req.params;
    const projects = await DynamoPMProject.getPMProjectsByClientId(clientId);
    res.status(200).json(projects);
  } catch (error) {
    console.error('❌ dynamoPMProjectController: Error getting PM projects by client ID:', error);
    res.status(500).json({ message: 'Failed to get PM projects', error: error.message });
  }
};

// Get PM project by lead ID
export const getPMProjectByLeadId = async (req, res) => {
  try {
    const { leadId } = req.params;
    const project = await DynamoPMProject.getPMProjectByLeadId(leadId);
    
    if (!project) {
      return res.status(404).json({ message: 'PM project not found for this lead' });
    }
    
    res.status(200).json(project);
  } catch (error) {
    console.error('❌ dynamoPMProjectController: Error getting PM project by lead ID:', error);
    res.status(500).json({ message: 'Failed to get PM project', error: error.message });
  }
};

// Update a PM project
export const updatePMProject = async (req, res) => {
  try {
    const { id } = req.params;
    const projectData = req.body;
    
    const updatedProject = await DynamoPMProject.updatePMProject(id, projectData);
    
    console.log('✅ dynamoPMProjectController: PM project updated successfully:', id);
    res.status(200).json(updatedProject);
  } catch (error) {
    console.error('❌ dynamoPMProjectController: Error updating PM project:', error);
    res.status(500).json({ message: 'Failed to update PM project', error: error.message });
  }
};

// Delete a PM project
export const deletePMProject = async (req, res) => {
  try {
    const { id } = req.params;
    await DynamoPMProject.deletePMProject(id);
    
    console.log('✅ dynamoPMProjectController: PM project deleted successfully:', id);
    res.status(200).json({ message: 'PM project deleted successfully' });
  } catch (error) {
    console.error('❌ dynamoPMProjectController: Error deleting PM project:', error);
    res.status(500).json({ message: 'Failed to delete PM project', error: error.message });
  }
};
