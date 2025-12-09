import express from 'express';
import multer from 'multer';
import { 
  getProducts, 
  addProduct, 
  updateProduct, 
  deleteProduct 
} from '../controllers/productController.js';

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
router.get('/products', getProducts);

// Add a new product
router.post('/products', productUploadMiddleware, addProduct);

// Update an existing product
router.put('/products', productUploadMiddleware, updateProduct);

// Delete a product
router.delete('/products', deleteProduct);

export default router;