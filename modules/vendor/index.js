// Vendor Module - Vendor management functionality
export { default as vendorRoutes } from './routes/vendorRoutes.js';
export { default as vendorLeadRoutes } from './routes/vendorLeadRoutes.js';
export { default as dynamoVendorRoutes } from './routes/dynamoVendorRoutes.js';
export { default as productRoutes } from './routes/productRoutes.js';
export { default as serviceRoutes } from './routes/serviceRoutes.js';

// Export controllers for direct access if needed
export * as vendorController from './controllers/vendorController.js';
export * as vendorLeadController from './controllers/vendorLeadController.js';
export * as dynamoVendorController from './controllers/dynamoVendorController.js';

// Export models
export * as DynamoVendor from './models/DynamoVendor.js';
export * as Vendor from './models/Vendor.js';
