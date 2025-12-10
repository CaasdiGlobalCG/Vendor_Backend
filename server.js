import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import session from 'express-session';
import passport from 'passport'; 
import mongoose from 'mongoose';
import http from 'http'; // Add http module for WebSocket server

// Import database connection
import connectDB from './config/db.js';
import './config/passport.js'; // 👈 Loads Google OAuth strategy

// Import remaining non-modular routes
// import authRoutes from './routes/authRoutes.js';
import dynamoAuthRoutes from './routes/dynamoAuthRoutes.js';
import fileRoutes from './routes/fileRoutes.js';
import s3Routes from './routes/s3.routes.js';  // Note the .js extension
// productRoutes and serviceRoutes are now in vendor module
import dynamoActivityRoutes from './routes/dynamoActivityRoutes.js';
import messageFileRoutes from './routes/messageFileRoutes.js';
import chimeRoutes from './routes/chimeRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import trunkyRoutes from './routes/trunkyRoutes.js';
import customersRoutes from './routes/customersRoutes.js';
import itemsRoutes from './routes/itemsRoutes.js';
import turnkeyWorkflowRoutes from './routes/turnkeyWorkflowRoutes.js';
import postServiceRoutes from './modules/post-services/routes/postServiceRoutes.js'; // New import for Post Services routes
import postServiceNotificationRoutes from './modules/post-services/routes/notificationRoutes.js'; // New import for Post Services Notifications routes
import dashboardRoutes from './routes/dashboard.routes.js';
import { getWorkspacePurchaseOrders } from './modules/workspace/controllers/workspacePurchaseOrdersController.js';

// Import WebSocket initialization
import { initWebSocketServer } from './websocket/notificationSocket.js';

// Import subscription scheduler
import { initializeSubscriptionScheduler } from './modules/workspace/services/subscriptionScheduler.js';

// Import DynamoDB contact model
import { createContact } from './models/DynamoContact.js';

dotenv.config();

const app = express();
const PORT = process.env.VENDOR_BACKEND_PORT;
const isProd = process.env.NODE_ENV === 'production';

const PROD_ORIGINS = ['https://caasdiglobal.in', 'https://www.caasdiglobal.in'];
const LOCAL_DEV_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5175',
  'http://localhost:5001',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:8080',
  'http://localhost:4173',
];

const allowedOrigins = Array.from(
  new Set(isProd ? PROD_ORIGINS : [...PROD_ORIGINS, ...LOCAL_DEV_ORIGINS])
);

// Create HTTP server (needed for WebSocket)
const server = http.createServer(app);


// Connect to MongoDB (still needed for GoogleUser model)
connectDB(); // your reusable connectDB function

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-user-info']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session config
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'someRandomSecret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      httpOnly: true, // Ensures cookie is not accessible via JavaScript
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // Adjusts based on environment
      secure: process.env.NODE_ENV === 'production', // Only true in production
    },
  })
);

// Passport config
app.use(passport.initialize());
app.use(passport.session());

// === Route for landing page contact form using DynamoDB ===
app.post("/api/contact", async (req, res) => {
  try {
    const { firstName, lastName, email, phone, message } = req.body;
    const contactData = { firstName, lastName, email, phone, message };
    await createContact(contactData);
    res.status(201).json({ message: "Form submitted successfully!" });
  } catch (error) {
    console.error("Error submitting contact form:", error);
    res.status(500).json({ message: "Server error. Please try again." });
  }
});

// === Health Check ===
app.get('/health', (req, res) => {
  res.json({ 
    success: true, 
    message: 'VendorDashboard Backend is running', 
    timestamp: new Date().toISOString(),
    modules: ['PM', 'Vendor', 'Workspace']
  });
});

// Lightweight fallback route for workspace purchase orders
// This guarantees /api/workspace/purchase-orders exists even if
// modular workspace routers are not mounted correctly in some envs.
app.get('/api/workspace/purchase-orders', async (req, res, next) => {
  try {
    await getWorkspacePurchaseOrders(req, res);
  } catch (err) {
    next(err);
  }
});

//s3-bucket
app.use('/api/s3', s3Routes);
app.use('/api/dashboard', dashboardRoutes);


// === Load Modular Routes ===
async function loadModules() {
  try {
    // Load PM Module
    console.log('🔄 Loading PM Module...');
    const pmModule = await import('./modules/pm/index.js');
    app.use('/api/pm-auth', pmModule.pmAuthRoutes);
    app.use('/api/pm-projects', pmModule.pmProjectRoutes);
    app.use('/api/pm-leads', pmModule.pmLeadRoutes);
    app.use('/api/pm-integration', pmModule.pmIntegrationRoutes);
    app.use('/api', pmModule.dynamoPMProjectRoutes);
    app.use('/api', pmModule.dynamoLeadRoutes);
    app.use('/api', pmModule.dynamoProjectRoutes);
    app.use('/api/project-leads', pmModule.dynamoProjectLeadRoutes);
    app.use('/api', pmModule.employeeRoutes); // Employee routes (public for CAS invitations)
    console.log('✅ PM Module loaded');

    // Load Vendor Module
    console.log('🔄 Loading Vendor Module...');
    const vendorModule = await import('./modules/vendor/index.js');
    app.use('/api/vendor', vendorModule.dynamoVendorRoutes);
    app.use('/api/vendor-leads', vendorModule.vendorLeadRoutes);
    app.use('/api/vendor', vendorModule.productRoutes); // Product routes
    app.use('/api/vendor', vendorModule.serviceRoutes); // Service routes
    console.log('✅ Vendor Module loaded');

    // Load Workspace Module
    console.log('🔄 Loading Workspace Module...');
    const workspaceModule = await import('./modules/workspace/index.js');
    app.use('/api/workspace-access', workspaceModule.workspaceAccessRoutes);
    app.use('/api/workspace', workspaceModule.workspaceRoutes); // This will include /purchase-requisitions and /procurement-requests routes
    app.use('/api', workspaceModule.dynamoWorkspaceRoutes);
    app.use('/api', workspaceModule.dynamoWorkspaceMessageRoutes);
    app.use('/api/workspace-files', workspaceModule.workspaceFileRoutes);
    
    // Also register procurement requests at root level for direct access
    const procurementRequestsRouter = await import('./modules/workspace/routes/procurementRequestsRoutes.js');
    app.use('/api/procurement-requests', procurementRequestsRouter.default);
    
    console.log('✅ Workspace Module loaded');

    // Load Post Services Module
    console.log('🔄 Loading Post Services Module...');
    app.use('/api', postServiceRoutes);
    app.use('/api', postServiceNotificationRoutes);
    console.log('✅ Post Services Module loaded');

    console.log('🎉 All modules loaded successfully');
    
    // Initialize subscription scheduler
    initializeSubscriptionScheduler();
  } catch (error) {
    console.error('❌ Error loading modules:', error);
  }
}

// === Non-modular API Routes ===
app.use('/api/auth', dynamoAuthRoutes); // Google login/callback/set-role
app.use('/api/files', fileRoutes); // File upload/delete routes
app.use('/api', dynamoActivityRoutes); // Activities routes
app.use('/api/message-files', messageFileRoutes); // Message File Upload routes
app.use('/api/chime', chimeRoutes); // Amazon Chime Video Call routes
app.use('/api/notifications', notificationRoutes); // Notifications routes
app.use('/api/trunky', trunkyRoutes); // Trunky Task Management routes
app.use('/api/customers', customersRoutes); // Customers routes
app.use('/api/items', itemsRoutes); // Items routes
app.use('/api/turnkey-workflows', turnkeyWorkflowRoutes); // Turnkey Workflow Management routes

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

// Initialize WebSocket server
const wss = initWebSocketServer(server);
console.log('✅ WebSocket server initialized');

// Load modules and start server
loadModules().then(() => {
  server.listen(PORT, () => {
    console.log(`✅ VendorDashboard Backend running on port ${PORT}`);
    const healthUrl = isProd ? 'https://caasdiglobal.in/health' : `http://localhost:${PORT}/health`;
    console.log(`📊 Health check: ${healthUrl}`);
  });
}).catch(error => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});