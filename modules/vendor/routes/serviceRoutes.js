import express from 'express';
import multer from 'multer';
import { 
  getServices, 
  addService, 
  updateService, 
  deleteService 
} from '../controllers/serviceController.js';

const router = express.Router();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Middleware for handling service image uploads
const serviceUploadMiddleware = upload.fields([
  { name: 'serviceImages', maxCount: 5 } // Allow up to 5 service images
]);

// Get all services for a vendor
router.get('/services', getServices);

// Add a new service
router.post('/services', serviceUploadMiddleware, addService);

// Update an existing service
router.put('/services', serviceUploadMiddleware, updateService);

// Delete a service
router.delete('/services', deleteService);

export default router;