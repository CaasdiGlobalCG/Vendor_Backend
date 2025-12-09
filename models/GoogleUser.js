/**
 * DEPRECATED: This file is no longer used in the application.
 * It has been replaced by DynamoDB implementations.
 * Kept for reference only.
 */

import mongoose from "mongoose";

const GoogleUserSchema = new mongoose.Schema({
  googleId: {
    type: String,
    required: true,
    unique: true,
  },
  cognitoId: {
    type: String,
    unique: true,
    sparse: true, // Allows null/undefined values for users without Cognito ID
  },
  displayName: String,
  email: String,
  role: {
    type: String,
    default: "", // will be updated after role-selection
  },
});

const GoogleUser = mongoose.model("GoogleUser", GoogleUserSchema);
export default GoogleUser;