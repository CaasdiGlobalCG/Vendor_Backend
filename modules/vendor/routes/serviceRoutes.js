import express from 'express';
import multer from 'multer';
import { 
  getServices, 
  addService, 
  updateService, 
  deleteService 
} from '../controllers/serviceController.js';
import { authenticateCognitoJwt } from '../../../middleware/cognitoJwtMiddleware.js';

const router = express.Router();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Middleware for handling service image uploads
const serviceUploadMiddleware = upload.fields([
  { name: 'serviceImages', maxCount: 5 } // Allow up to 5 service images
]);

// Get all services for a vendor
router.get('/services', authenticateCognitoJwt, getServices);

// Add a new service
router.post('/services', authenticateCognitoJwt, serviceUploadMiddleware, addService);

// Update an existing service
router.put('/services', authenticateCognitoJwt, serviceUploadMiddleware, updateService);

// Delete a service
router.delete('/services', authenticateCognitoJwt, deleteService);

export default router;