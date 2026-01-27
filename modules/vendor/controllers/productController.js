import * as DynamoVendor from '../models/DynamoVendor.js';
import { uploadFileToS3, deleteFileFromS3 } from '../../../utils/s3Utils.js';
import { v4 as uuidv4 } from 'uuid';
import {
  listProductsByVendorId,
  getProductById as getProductByIdFromTable,
  putProduct,
  deleteProductById as deleteProductByIdFromTable,
} from '../models/DynamoProducts.js';

/**
 * Get all products for a vendor
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getProducts = async (req, res) => {
  try {
    const email = req.auth?.email || req.query.email;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    // Resolve vendorId from the authenticated vendor
    const vendor = await DynamoVendor.getVendorByEmail(email);

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    const vendorId = vendor.vendorId || vendor.id;
    if (!vendorId) {
      return res.status(400).json({
        success: false,
        message: 'VendorId not found for this vendor'
      });
    }

    const products = await listProductsByVendorId(vendorId);

    res.status(200).json({
      success: true,
      data: products
    });
  } catch (error) {
    console.error('Error getting products:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting products',
      error: error.message
    });
  }
};

/**
 * Add a new product for a vendor
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const addProduct = async (req, res) => {
  try {
    console.log('Add product request received:', {
      body: req.body,
      files: req.files ? Object.keys(req.files).map(key => `${key}: ${req.files[key].length} files`) : 'No files'
    });

    const email = req.auth?.email || req.body?.email;
    const productData = JSON.parse(req.body.productData || '{}');

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    const vendor = await DynamoVendor.getVendorByEmail(email);

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    const vendorId = vendor.vendorId || vendor.id;
    if (!vendorId) {
      return res.status(400).json({
        success: false,
        message: 'VendorId not found for this vendor'
      });
    }

    // Generate a unique ID for the product
    const productId = uuidv4();

    // Handle product image uploads
    const imageUrls = [];
    if (req.files && req.files.productImages) {
      try {
        for (const file of req.files.productImages) {
          const s3Url = await uploadFileToS3(
            file.buffer,
            file.originalname,
            file.mimetype,
            `products/${productId}`
          );
          
          // Products table schema uses string URLs for images
          imageUrls.push(s3Url);
          
          console.log('Product image uploaded to S3:', s3Url);
        }
      } catch (error) {
        console.error('Error uploading product images to S3:', error);
        // Continue with the product creation even if image uploads fail
      }
    }

    // Handle product PDF upload
    let productPdf = null;
    if (req.files && req.files.productPdf && req.files.productPdf[0]) {
      try {
        const pdfFile = req.files.productPdf[0];
        const s3Url = await uploadFileToS3(
          pdfFile.buffer,
          pdfFile.originalname,
          pdfFile.mimetype,
          `products/${productId}/pdfs`
        );
        
        productPdf = {
          url: s3Url,
          originalName: pdfFile.originalname,
          contentType: pdfFile.mimetype,
          uploadedAt: new Date().toISOString()
        };
        
        console.log('Product PDF uploaded to S3:', s3Url);
      } catch (error) {
        console.error('Error uploading product PDF to S3:', error);
        // Continue with the product creation even if PDF upload fails
      }
    }

    // Create the new product object
    const now = Date.now();
    const newProduct = {
      vendorId,
      productId,
      ...productData,
      // Keep compatibility with the schema you shared
      productName: productData.productName || productData.name || productData.productInfo?.productName || productData.productTitle || productData.title,
      productCategory: productData.productCategory || productData.category || productData.productInfo?.productCategory,
      images: imageUrls.length > 0 ? imageUrls : (Array.isArray(productData.images) ? productData.images : []),
      documents: Array.isArray(productData.documents) ? productData.documents : [],
      status: productData.status || 'DRAFT',
      userId: productData.userId || req.auth?.sub || productData.sub || null,
      createdAt: productData.createdAt || now,
      updatedAt: now,
      // Store PDF as a document entry (optional)
      ...(productPdf ? { productPdf } : {}),
    };

    await putProduct(newProduct);

    res.status(201).json({
      success: true,
      message: 'Product added successfully',
      data: newProduct
    });
  } catch (error) {
    console.error('Error adding product:', error);
    res.status(500).json({
      success: false,
      message: 'Error adding product',
      error: error.message
    });
  }
};

/**
 * Update an existing product
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const updateProduct = async (req, res) => {
  try {
    console.log('Update product request received:', {
      body: req.body,
      files: req.files ? Object.keys(req.files).map(key => `${key}: ${req.files[key].length} files`) : 'No files'
    });

    const email = req.auth?.email || req.body?.email;
    const { productId } = req.body;
    const productData = JSON.parse(req.body.productData || '{}');

    if (!email || !productId) {
      return res.status(400).json({
        success: false,
        message: 'Email and productId are required'
      });
    }

    const vendor = await DynamoVendor.getVendorByEmail(email);

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    const vendorId = vendor.vendorId || vendor.id;
    if (!vendorId) {
      return res.status(400).json({
        success: false,
        message: 'VendorId not found for this vendor'
      });
    }

    const existingProduct = await getProductByIdFromTable(vendorId, productId);
    if (!existingProduct) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Handle product image uploads
    let imageUrls = Array.isArray(existingProduct.images) ? [...existingProduct.images] : [];
    
    // Handle image deletions if specified
    const deleteImages = req.body.deleteImages ? JSON.parse(req.body.deleteImages) : [];
    if (deleteImages.length > 0) {
      // Delete the specified images from S3
      for (const imageUrl of deleteImages) {
        try {
          await deleteFileFromS3(imageUrl);
          console.log('Deleted image from S3:', imageUrl);
        } catch (error) {
          console.error('Error deleting image from S3:', error);
          // Continue with the update even if image deletion fails
        }
      }
      
      // Filter out deleted URLs (schema uses string URLs)
      imageUrls = imageUrls.filter(url => !deleteImages.includes(url));
    }
    
    // Add new images if provided
    if (req.files && req.files.productImages) {
      try {
        for (const file of req.files.productImages) {
          const s3Url = await uploadFileToS3(
            file.buffer,
            file.originalname,
            file.mimetype,
            `products/${productId}`
          );
          
          imageUrls.push(s3Url);
          
          console.log('Product image uploaded to S3:', s3Url);
        }
      } catch (error) {
        console.error('Error uploading product images to S3:', error);
        // Continue with the product update even if image uploads fail
      }
    }

    // Update the product
    const updatedProduct = {
      ...existingProduct,
      ...productData,
      vendorId,
      productId,
      productName: productData.productName || productData.name || existingProduct.productName,
      productCategory: productData.productCategory || productData.category || existingProduct.productCategory,
      images: imageUrls,
      updatedAt: Date.now(),
    };

    await putProduct(updatedProduct);

    res.status(200).json({
      success: true,
      message: 'Product updated successfully',
      data: updatedProduct
    });
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating product',
      error: error.message
    });
  }
};

/**
 * Delete a product
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const deleteProduct = async (req, res) => {
  try {
    const email = req.auth?.email || req.body?.email;
    const { productId } = req.body;

    if (!email || !productId) {
      return res.status(400).json({
        success: false,
        message: 'Email and productId are required'
      });
    }

    const vendor = await DynamoVendor.getVendorByEmail(email);

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    const vendorId = vendor.vendorId || vendor.id;
    if (!vendorId) {
      return res.status(400).json({
        success: false,
        message: 'VendorId not found for this vendor'
      });
    }

    const productToDelete = await getProductByIdFromTable(vendorId, productId);
    if (!productToDelete) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Delete product images from S3
    if (productToDelete.images && Array.isArray(productToDelete.images)) {
      for (const image of productToDelete.images) {
        try {
          const url = typeof image === 'string' ? image : image?.url;
          if (url) {
            await deleteFileFromS3(url);
            console.log('Deleted image from S3:', url);
          }
        } catch (error) {
          console.error('Error deleting image from S3:', error);
          // Continue with the product deletion even if image deletion fails
        }
      }
    }

    await deleteProductByIdFromTable(vendorId, productId);

    res.status(200).json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting product',
      error: error.message
    });
  }
};