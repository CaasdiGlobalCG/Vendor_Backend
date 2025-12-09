/**
 * Script to mark deprecated files in the backend
 * Run with: node scripts/markDeprecatedFiles.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// List of files to mark as deprecated
const deprecatedFiles = [
  // MongoDB connection
  'config/db.js',
  
  // MongoDB models
  'models/GoogleUser.js',
  'models/Vendor.js',
  
  // Old controllers
  'controllers/authController.js',
  'controllers/vendorController.js',
  
  // Old routes
  'routes/authRoutes.js',
  'routes/vendorRoutes.js',
  
  // Other
  'auth/googleAuth.js'
];

// Deprecation notice to add at the top of each file
const deprecationNotice = `/**
 * DEPRECATED: This file is no longer used in the application.
 * It has been replaced by DynamoDB implementations.
 * Kept for reference only.
 */

`;

// Process each file
deprecatedFiles.forEach(relativeFilePath => {
  const filePath = path.join(__dirname, '..', relativeFilePath);
  
  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.log(`File not found: ${filePath}`);
      return;
    }
    
    // Read the file content
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Check if already marked as deprecated
    if (content.includes('DEPRECATED:')) {
      console.log(`File already marked as deprecated: ${relativeFilePath}`);
      return;
    }
    
    // Add deprecation notice and write back
    const newContent = deprecationNotice + content;
    fs.writeFileSync(filePath, newContent);
    
    console.log(`Marked as deprecated: ${relativeFilePath}`);
  } catch (error) {
    console.error(`Error processing ${relativeFilePath}:`, error);
  }
});

console.log('Finished marking deprecated files.');