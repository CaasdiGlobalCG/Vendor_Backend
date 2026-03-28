import * as DynamoProject from '../models/DynamoProject.js';
import { canAccessProject } from '../../rbac/utils/scopeAccess.utils.js';

// Create a new project
export const createProject = async (req, res) => {
  try {
    const projectData = req.body;
    const newProject = await DynamoProject.createProject(projectData);
    res.status(201).json(newProject);
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ message: 'Failed to create project', error: error.message });
  }
};

// Get all projects
export const getAllProjects = async (req, res) => {
  try {
    const projects = await DynamoProject.getAllProjects();
    const scopedProjects = projects.filter((project) => canAccessProject(req.rbac, project.projectId || project.id));
    res.json(scopedProjects);
  } catch (error) {
    console.error('Error getting all projects:', error);
    res.status(500).json({ message: 'Failed to get projects', error: error.message });
  }
};

// Get project by ID
export const getProjectById = async (req, res) => {
  try {
    const { id } = req.params;
    const project = await DynamoProject.getProjectById(id);
    
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }
    
    if (!canAccessProject(req.rbac, project.projectId || project.id)) {
      return res.status(403).json({ message: 'Access denied for this project' });
    }

    res.json(project);
  } catch (error) {
    console.error('Error getting project by ID:', error);
    res.status(500).json({ message: 'Failed to get project', error: error.message });
  }
};

// Get projects by vendor ID
export const getProjectsByVendorId = async (req, res) => {
  try {
    const { vendorId } = req.params;
    if (req.vendorId && String(req.vendorId) !== String(vendorId) && !req.rbac?.isSuperAdmin) {
      return res.status(403).json({ message: 'Cannot access another vendor\'s projects' });
    }

    const projects = await DynamoProject.getProjectsByVendorId(vendorId);
    const scopedProjects = projects.filter((project) => canAccessProject(req.rbac, project.projectId || project.id));
    res.json(scopedProjects);
  } catch (error) {
    console.error('Error getting projects by vendor ID:', error);
    res.status(500).json({ message: 'Failed to get projects', error: error.message });
  }
};

// Get projects by client ID
export const getProjectsByClientId = async (req, res) => {
  try {
    const { clientId } = req.params;
    const projects = await DynamoProject.getProjectsByClientId(clientId);
    const scopedProjects = projects.filter((project) => canAccessProject(req.rbac, project.projectId || project.id));
    res.json(scopedProjects);
  } catch (error) {
    console.error('Error getting projects by client ID:', error);
    res.status(500).json({ message: 'Failed to get projects', error: error.message });
  }
};

// Update a project
export const updateProject = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    // Check if the project exists
    const existingProject = await DynamoProject.getProjectById(id);
    
    if (!existingProject) {
      return res.status(404).json({ message: 'Project not found' });
    }
    
    if (!canAccessProject(req.rbac, existingProject.projectId || existingProject.id)) {
      return res.status(403).json({ message: 'Access denied for this project' });
    }

    const updatedProject = await DynamoProject.updateProject(id, updateData);
    res.json(updatedProject);
  } catch (error) {
    console.error('Error updating project:', error);
    res.status(500).json({ message: 'Failed to update project', error: error.message });
  }
};

// Delete a project
export const deleteProject = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if the project exists
    const existingProject = await DynamoProject.getProjectById(id);
    
    if (!existingProject) {
      return res.status(404).json({ message: 'Project not found' });
    }
    
    if (!canAccessProject(req.rbac, existingProject.projectId || existingProject.id)) {
      return res.status(403).json({ message: 'Access denied for this project' });
    }

    await DynamoProject.deleteProject(id);
    res.json({ message: 'Project deleted successfully' });
  } catch (error) {
    console.error('Error deleting project:', error);
    res.status(500).json({ message: 'Failed to delete project', error: error.message });
  }
};