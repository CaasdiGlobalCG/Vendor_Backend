import * as DynamoVendor from '../models/DynamoVendor.js';
import { uploadFileToS3, deleteFileFromS3 } from '../../../utils/s3Utils.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Get all products for a vendor
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getProducts = async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    // Get the vendor from DynamoDB
    const vendor = await DynamoVendor.getVendorByEmail(email);

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    // Check if the vendor has products
    if (!vendor.products || !Array.isArray(vendor.products) || vendor.products.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No products found',
        data: []
      });
    }

    // Return the products
    res.status(200).json({
      success: true,
      data: vendor.products
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

    const { email } = req.body;
    const productData = JSON.parse(req.body.productData || '{}');

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    // Get the vendor from DynamoDB
    const vendor = await DynamoVendor.getVendorByEmail(email);

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
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
          
          imageUrls.push({
            url: s3Url,
            originalName: file.originalname,
            contentType: file.mimetype,
            uploadedAt: new Date().toISOString()
          });
          
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
    const newProduct = {
      id: productId,
      ...productData,
      images: imageUrls,
      productPdf: productPdf,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Add the product to the vendor's products array
    const updatedProducts = vendor.products ? [...vendor.products, newProduct] : [newProduct];
    
    // Update the vendor in DynamoDB
    await DynamoVendor.updateVendor(vendor.id, { products: updatedProducts });

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

    const { email, productId } = req.body;
    const productData = JSON.parse(req.body.productData || '{}');

    if (!email || !productId) {
      return res.status(400).json({
        success: false,
        message: 'Email and productId are required'
      });
    }

    // Get the vendor from DynamoDB
    const vendor = await DynamoVendor.getVendorByEmail(email);

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    // Check if the vendor has products
    if (!vendor.products || !Array.isArray(vendor.products)) {
      return res.status(404).json({
        success: false,
        message: 'No products found for this vendor'
      });
    }

    // Find the product to update
    const productIndex = vendor.products.findIndex(p => p.id === productId);
    
    if (productIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Get the existing product
    const existingProduct = vendor.products[productIndex];

    // Handle product image uploads
    let imageUrls = existingProduct.images || [];
    
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
      
      // Filter out the deleted images from the imageUrls array
      imageUrls = imageUrls.filter(img => !deleteImages.includes(img.url));
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
          
          imageUrls.push({
            url: s3Url,
            originalName: file.originalname,
            contentType: file.mimetype,
            uploadedAt: new Date().toISOString()
          });
          
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
      images: imageUrls,
      updatedAt: new Date().toISOString()
    };

    // Update the product in the vendor's products array
    const updatedProducts = [...vendor.products];
    updatedProducts[productIndex] = updatedProduct;
    
    // Update the vendor in DynamoDB
    await DynamoVendor.updateVendor(vendor.id, { products: updatedProducts });

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
    const { email, productId } = req.body;

    if (!email || !productId) {
      return res.status(400).json({
        success: false,
        message: 'Email and productId are required'
      });
    }

    // Get the vendor from DynamoDB
    const vendor = await DynamoVendor.getVendorByEmail(email);

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    // Check if the vendor has products
    if (!vendor.products || !Array.isArray(vendor.products)) {
      return res.status(404).json({
        success: false,
        message: 'No products found for this vendor'
      });
    }

    // Find the product to delete
    const productIndex = vendor.products.findIndex(p => p.id === productId);
    
    if (productIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Get the product to delete
    const productToDelete = vendor.products[productIndex];

    // Delete product images from S3
    if (productToDelete.images && Array.isArray(productToDelete.images)) {
      for (const image of productToDelete.images) {
        try {
          if (image.url) {
            await deleteFileFromS3(image.url);
            console.log('Deleted image from S3:', image.url);
          }
        } catch (error) {
          console.error('Error deleting image from S3:', error);
          // Continue with the product deletion even if image deletion fails
        }
      }
    }

    // Remove the product from the vendor's products array
    const updatedProducts = vendor.products.filter(p => p.id !== productId);
    
    // Update the vendor in DynamoDB
    await DynamoVendor.updateVendor(vendor.id, { products: updatedProducts });

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