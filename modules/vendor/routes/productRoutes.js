import express from 'express';
import multer from 'multer';
import { 
  getProducts, 
  addProduct, 
  updateProduct, 
  deleteProduct 
} from '../controllers/productController.js';
import { authenticateCognitoJwt } from '../../../middleware/cognitoJwtMiddleware.js';

const router = express.Router();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Middleware for handling product image uploads
const productUploadMiddleware = upload.fields([
  { name: 'productImages', maxCount: 5 }, // Allow up to 5 product images
  { name: 'productPdf', maxCount: 1 } // Allow 1 product PDF
]);

// Get all products for a vendor
router.get('/products', authenticateCognitoJwt, getProducts);

// Add a new product
router.post('/products', authenticateCognitoJwt, productUploadMiddleware, addProduct);

// Update an existing product
router.put('/products', authenticateCognitoJwt, productUploadMiddleware, updateProduct);

// Delete a product
router.delete('/products', authenticateCognitoJwt, deleteProduct);

export default router;