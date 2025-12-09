# VendorDashboard Backend - Modular Architecture

## 🏗️ Architecture Overview

The VendorDashboard backend has been reorganized into a modular architecture with three main modules:

- **PM Module** - Project Management functionality
- **Vendor Module** - Vendor management functionality  
- **Workspace Module** - Workspace and collaboration functionality

## 📁 Directory Structure

```
VendorDashboard/backend/
├── modules/
│   ├── pm/
│   │   ├── controllers/
│   │   ├── routes/
│   │   ├── models/
│   │   └── index.js
│   ├── vendor/
│   │   ├── controllers/
│   │   ├── routes/
│   │   ├── models/
│   │   └── index.js
│   └── workspace/
│       ├── controllers/
│       ├── routes/
│       ├── models/
│       └── index.js
├── config/
├── middleware/
├── auth/
├── utils/
├── websocket/
├── controllers/ (remaining shared controllers)
├── routes/ (remaining shared routes)
├── models/ (remaining shared models)
└── server.js
```

## 🔧 PM Module

**Location**: `modules/pm/`

### Controllers:
- `pmAuthController.js` - PM authentication
- `pmIntegrationController.js` - PM integrations
- `pmLeadController.js` - PM lead management
- `pmProjectController.js` - PM project management
- `dynamoPMProjectController.js` - DynamoDB PM projects
- `dynamoLeadController.js` - DynamoDB leads
- `dynamoProjectController.js` - DynamoDB projects
- `employeeController.js` - Employee management for CAS invitations

### Routes:
- `pmAuthRoutes.js` - `/api/pm-auth/*`
- `pmIntegrationRoutes.js` - `/api/pm-integration/*`
- `pmLeadRoutes.js` - `/api/pm-leads/*`
- `pmProjectRoutes.js` - `/api/pm-projects/*`
- `dynamoPMProjectRoutes.js` - `/api/*` (PM projects)
- `dynamoLeadRoutes.js` - `/api/*` (leads)
- `dynamoProjectRoutes.js` - `/api/*` (projects)
- `dynamoProjectLeadRoutes.js` - `/api/project-leads/*`
- `employeeRoutes.js` - `/api/*` (employees)

### Models:
- `DynamoPMProject.js` - PM project data model
- `DynamoLead.js` - Lead data model
- `DynamoProject.js` - Project data model
- `DynamoProjectLead.js` - Project lead relationship model

## 🏢 Vendor Module

**Location**: `modules/vendor/`

### Controllers:
- `vendorController.js` - Vendor management
- `vendorLeadController.js` - Vendor lead management
- `dynamoVendorController.js` - DynamoDB vendor operations

### Routes:
- `vendorRoutes.js` - `/api/vendor/*` (vendor management)
- `vendorLeadRoutes.js` - `/api/vendor-leads/*`
- `dynamoVendorRoutes.js` - `/api/vendor/*` (DynamoDB operations)

### Models:
- `DynamoVendor.js` - Vendor data model
- `Vendor.js` - Vendor business logic model

## 🏗️ Workspace Module

**Location**: `modules/workspace/`

### Controllers:
- `workspaceController.js` - Workspace management
- `workspaceAccessController.js` - Workspace access control
- `workspaceFileController.js` - Workspace file management
- `workspaceQuotesController.js` - Workspace quotes
- `dynamoWorkspaceController.js` - DynamoDB workspace operations
- `dynamoWorkspaceMessageController.js` - Workspace messaging

### Routes:
- `workspaceRoutes.js` - `/api/workspace/*`
- `workspaceAccessRoutes.js` - `/api/workspace-access/*`
- `workspaceFileRoutes.js` - `/api/workspace-files/*`
- `workspaceQuotesRoutes.js` - `/api/workspace/quotes/*`
- `dynamoWorkspaceRoutes.js` - `/api/*` (workspace operations)
- `dynamoWorkspaceMessageRoutes.js` - `/api/*` (workspace messages)

### Models:
- `DynamoWorkspace.js` - Workspace data model
- `DynamoWorkspaceMessage.js` - Workspace message model

## 🚀 Server Configuration

The `server.js` file has been updated to use dynamic module loading:

```javascript
// Load modules dynamically
async function loadModules() {
  // Load PM Module
  const pmModule = await import('./modules/pm/index.js');
  app.use('/api/pm-auth', pmModule.pmAuthRoutes);
  // ... other PM routes
  
  // Load Vendor Module
  const vendorModule = await import('./modules/vendor/index.js');
  app.use('/api/vendor', vendorModule.dynamoVendorRoutes);
  // ... other vendor routes
  
  // Load Workspace Module
  const workspaceModule = await import('./modules/workspace/index.js');
  app.use('/api/workspace', workspaceModule.workspaceRoutes);
  // ... other workspace routes
}
```

## 📊 API Endpoints by Module

### PM Module Endpoints:
```
GET/POST /api/pm-auth/*           - PM authentication
GET/POST /api/pm-projects/*       - PM project management
GET/POST /api/pm-leads/*          - PM lead management
GET/POST /api/pm-integration/*    - PM integrations
GET/POST /api/project-leads/*     - Project lead relationships
GET/POST /api/*                   - Employee management (CAS)
```

### Vendor Module Endpoints:
```
GET/POST /api/vendor/*            - Vendor management
GET/POST /api/vendor-leads/*      - Vendor lead management
```

### Workspace Module Endpoints:
```
GET/POST /api/workspace/*         - Workspace management
GET/POST /api/workspace-access/*  - Access control
GET/POST /api/workspace-files/*   - File management
GET/POST /api/workspace/quotes/*  - Quotes management
```

## 🔧 Benefits of Modular Architecture

1. **Separation of Concerns**: Each module handles specific functionality
2. **Maintainability**: Easier to maintain and update individual modules
3. **Scalability**: Modules can be scaled independently
4. **Team Development**: Different teams can work on different modules
5. **Code Organization**: Better code organization and structure
6. **Testing**: Easier to test individual modules
7. **Deployment**: Potential for module-specific deployments

## 🚀 Getting Started

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Start the Server**:
   ```bash
   npm start
   ```

3. **Health Check**:
   ```bash
   curl http://localhost:5001/health
   ```

## 🔍 Module Loading Process

1. Server starts and loads core configuration
2. Modules are loaded dynamically using ES6 imports
3. Each module exports its routes and controllers via `index.js`
4. Routes are mounted with appropriate prefixes
5. WebSocket server is initialized
6. Server starts listening on configured port

## 📝 Development Guidelines

1. **Adding New Features**: Add to the appropriate module
2. **Cross-Module Dependencies**: Use shared utilities in root directories
3. **Database Models**: Keep module-specific models in module directories
4. **Route Prefixes**: Follow established patterns for API endpoints
5. **Error Handling**: Use consistent error handling across modules

## 🎯 Future Enhancements

- **Module-specific middleware**: Add module-specific authentication/authorization
- **Module versioning**: Support for API versioning per module
- **Module hot-reloading**: Development-time hot reloading of modules
- **Module metrics**: Individual module performance monitoring
- **Module documentation**: Auto-generated API documentation per module

This modular architecture provides a solid foundation for scalable backend development while maintaining the existing functionality and API compatibility.





