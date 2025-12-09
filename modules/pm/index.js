// PM Module - Project Management functionality
export { default as pmAuthRoutes } from './routes/pmAuthRoutes.js';
export { default as pmIntegrationRoutes } from './routes/pmIntegrationRoutes.js';
export { default as pmLeadRoutes } from './routes/pmLeadRoutes.js';
export { default as pmProjectRoutes } from './routes/pmProjectRoutes.js';
export { default as dynamoPMProjectRoutes } from './routes/dynamoPMProjectRoutes.js';
export { default as dynamoLeadRoutes } from './routes/dynamoLeadRoutes.js';
export { default as dynamoProjectRoutes } from './routes/dynamoProjectRoutes.js';
export { default as dynamoProjectLeadRoutes } from './routes/dynamoProjectLeadRoutes.js';
export { default as employeeRoutes } from './routes/employeeRoutes.js';

// Export controllers for direct access if needed
export * as pmAuthController from './controllers/pmAuthController.js';
export * as pmIntegrationController from './controllers/pmIntegrationController.js';
export * as pmLeadController from './controllers/pmLeadController.js';
export * as pmProjectController from './controllers/pmProjectController.js';
export * as dynamoPMProjectController from './controllers/dynamoPMProjectController.js';
export * as dynamoLeadController from './controllers/dynamoLeadController.js';
export * as dynamoProjectController from './controllers/dynamoProjectController.js';
export * as employeeController from './controllers/employeeController.js';

// Export models
export * as DynamoPMProject from './models/DynamoPMProject.js';
export * as DynamoLead from './models/DynamoLead.js';
export * as DynamoProject from './models/DynamoProject.js';
export * as DynamoProjectLead from './models/DynamoProjectLead.js';
