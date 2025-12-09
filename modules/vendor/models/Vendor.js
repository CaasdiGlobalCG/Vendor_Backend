/**
 * DEPRECATED: This file is no longer used in the application.
 * It has been replaced by DynamoDB implementations.
 * Kept for reference only.
 */

import mongoose from 'mongoose';
const vendorSchema = new mongoose.Schema({
  email: {
    type: String,
    required: false,
    unique: true
  },
  name: {
    type: String,
    required: false
  },
  uid: {
    type: String,
    required: false
  },
  hasFilledForm: {
    type: Boolean,
    default: false
  },
  vendorDetails: {
    type: Object,
    required: true,
    default: {}
  },
  companyDetails: {
    type: Object,
    required: true,
    default: {}
  },
  serviceProductDetails: {
    type: Object,
    required: true,
    default: {}
  },
  bankDetails: {
    type: Object,
    required: true,
    default: {}
  },
  complianceCertifications: {
    type: Object,
    required: true,
    default: {}
  },
  additionalDetails: {
    type: Object,
    required: true,
    default: {}
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  role: {
    type: String,
    enum: ['vendor', 'client'],
    default: 'vendor'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Vendor = mongoose.model('Vendor', vendorSchema);

export default Vendor;