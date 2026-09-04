// FILE: scripts/seedPhysicalKYCChecklists.js
// PURPOSE: Seeds DynamoDB with Physical KYC checklist templates from vendorKYCcheclist.md
// RUN: node scripts/seedPhysicalKYCChecklists.js
// CONNECTS TO: config/aws.js (PHYSICAL_KYC_CHECKLISTS_TABLE)

import { dynamoDB, PHYSICAL_KYC_CHECKLISTS_TABLE } from '../config/aws.js';
import { v4 as uuidv4 } from 'uuid';

// ─── Service Provider Physical KYC Template ───────────────────────────────────

const SERVICE_PROVIDER_PHYSICAL = {
  name: 'Service Provider — Onsite Physical Inspection Checklist',
  vendorType: 'service_provider',
  verificationMode: 'physical',
  isTemplate: true,
  createdBy: 'system',
  sections: [
    {
      sectionId: 'A',
      sectionName: 'Entity Identity & Legal Standing',
      items: [
        { itemId: 'A1', description: 'Certificate of Incorporation / Registration Certificate — Verify company name, CIN, date of incorporation, registered office', required: true, evidenceType: 'original_document' },
        { itemId: 'A2', description: 'Memorandum & Articles of Association (MoA / AoA) — Verify business objects clause covers services offered', required: true, evidenceType: 'original_document' },
        { itemId: 'A3', description: 'Partnership Deed / LLP Agreement (if applicable) — Verify partners, profit-sharing, authority clauses', required: false, evidenceType: 'original_document' },
        { itemId: 'A4', description: 'PAN Card (Entity) — Match PAN with GST registration and bank account name', required: true, evidenceType: 'original_document' },
        { itemId: 'A5', description: 'GSTIN Registration Certificate — Verify GSTIN, business category, registration status on GST portal', required: true, evidenceType: 'portal_screenshot' },
        { itemId: 'A6', description: 'Trade Licence / Shops & Establishment Certificate — Validate operational legitimacy', required: true, evidenceType: 'original_document' },
        { itemId: 'A7', description: 'Import Export Code (IEC) — if cross-border services, match with DGFT portal', required: false, evidenceType: 'original_document' },
        { itemId: 'A8', description: 'Professional Tax Registration (PT) — Verify state-level compliance', required: true, evidenceType: 'original_document' },
      ],
    },
    {
      sectionId: 'B',
      sectionName: 'Ownership, Directors & UBO',
      items: [
        { itemId: 'B1', description: 'List of Directors / Partners / Proprietor — Obtain with DINs; cross-check with MCA portal', required: true, evidenceType: 'mca_extract' },
        { itemId: 'B2', description: 'KYC of Key Directors / Authorised Signatories — Aadhaar + PAN + Photo for each', required: false, evidenceType: 'original_document' },
        { itemId: 'B3', description: 'Ultimate Beneficial Owner (UBO) Declaration — Identify individuals owning >10%', required: true, evidenceType: 'signed_declaration' },
        { itemId: 'B4', description: 'Board Resolution / Authority Letter for contracting — Confirm who is authorised to sign', required: true, evidenceType: 'original_document' },
        { itemId: 'B5', description: 'Shareholding Pattern / Ownership Structure Chart — Map full ownership chain', required: false, evidenceType: 'company_provided' },
      ],
    },
    {
      sectionId: 'C',
      sectionName: 'Financial Standing',
      items: [
        { itemId: 'C1', description: 'Audited Financial Statements (Last 2–3 Years) — P&L, Balance Sheet, Cash Flow', required: true, evidenceType: 'original_document' },
        { itemId: 'C2', description: 'ITR (Last 2 Years) with Computation — Match declared income; verify tax compliance', required: true, evidenceType: 'original_document' },
        { itemId: 'C3', description: 'Bank Statement (Last 6 Months) — Check transaction health, salary credits, returned cheques', required: true, evidenceType: 'banker_stamped' },
        { itemId: 'C4', description: 'Bank Account Verification Letter / Cancelled Cheque — Confirm IFSC, MICR', required: true, evidenceType: 'original_document' },
        { itemId: 'C5', description: 'Credit Rating / CIBIL Score (Entity) — Obtain commercial report or CARE/ICRA rating', required: false, evidenceType: 'agency_report' },
        { itemId: 'C6', description: 'GST Returns (Last 6 Months — GSTR-1, GSTR-3B) — Cross-check turnover declared', required: true, evidenceType: 'portal_screenshot' },
      ],
    },
    {
      sectionId: 'D',
      sectionName: 'Service Capability & Infrastructure',
      items: [
        { itemId: 'D1', description: 'Company Profile / Credential Deck — Review service offerings, client list, experience', required: true, evidenceType: 'photo_evidence' },
        { itemId: 'D2', description: 'Physical Office / Delivery Centre Inspection — Confirm operational premises, staff presence, equipment', required: true, evidenceType: 'site_visit_photos' },
        { itemId: 'D3', description: 'Team Size & Organisational Chart — Validate headcount vs scope of work commitments', required: true, evidenceType: 'onsite_observation' },
        { itemId: 'D4', description: 'Key Personnel CVs / Credentials — Review qualifications of team leads', required: true, evidenceType: 'original_document' },
        { itemId: 'D5', description: 'Professional Licences / Certifications (ISO 9001, ISO 27001, CA/CS etc.)', required: false, evidenceType: 'original_document' },
        { itemId: 'D6', description: 'Technology / Tool Stack Declaration — Confirm software, platforms, CRM/ERP tools', required: true, evidenceType: 'demo_observation' },
        { itemId: 'D7', description: 'Data Security & IT Infrastructure Assessment — Firewall, access controls, encryption', required: true, evidenceType: 'it_audit' },
        { itemId: 'D8', description: 'Sub-contractor / Third-party Dependency Disclosure — Identify outsourced services', required: true, evidenceType: 'onsite_observation' },
      ],
    },
    {
      sectionId: 'E',
      sectionName: 'Compliance, Litigation & Reputation',
      items: [
        { itemId: 'E3', description: 'Labour Law Compliance Certificate — Contract Labour Act, Minimum Wages', required: true, evidenceType: 'certificate' },
        { itemId: 'E4', description: 'Litigation / Legal Dispute Disclosure — Self-declaration on pending suits, arbitration', required: true, evidenceType: 'signed_declaration' },
        { itemId: 'E5', description: 'Blacklist / Debarment Check — Cross-check against EPFO, NPCI, CVC, MCA21, SFIO', required: true, evidenceType: 'database_check' },
        { itemId: 'E8', description: 'Reference Check (2 Client References) — Verify quality of service delivery', required: true, evidenceType: 'reference_verification' },
      ],
    },
    {
      sectionId: 'F',
      sectionName: 'Contractual & Onboarding Documents',
      items: [
        { itemId: 'F1', description: 'Signed Vendor NDA — Executed before sharing proprietary information', required: true, evidenceType: 'original_document' },
        { itemId: 'F2', description: 'Vendor Application / Onboarding Form — Standardised form capturing all vendor master data', required: true, evidenceType: 'original_document' },
        { itemId: 'F3', description: 'Vendor DPA (Data Processing Agreement) — Required if vendor handles personal data', required: false, evidenceType: 'executed_original' },
        { itemId: 'F4', description: 'Service Agreement / Rate Contract — Scope, SLAs, penalties, IP ownership, exit clauses', required: true, evidenceType: 'original_document' },
        { itemId: 'F7', description: 'Vendor Code Assignment & System Entry — Create vendor master in ERP/accounting system', required: true, evidenceType: 'system_record' },
      ],
    },
  ],
};

// ─── Manufacturer Physical KYC Template ──────────────────────────────────────

const MANUFACTURER_PHYSICAL = {
  name: 'Manufacturer — Onsite Physical Inspection Checklist',
  vendorType: 'manufacturer',
  verificationMode: 'physical',
  isTemplate: true,
  createdBy: 'system',
  sections: [
    {
      sectionId: 'A',
      sectionName: 'Entity Identity & Legal Standing',
      items: [
        { itemId: 'A1', description: 'Certificate of Incorporation — Verify company name, CIN, incorporation date, registered office', required: true, evidenceType: 'original_document' },
        { itemId: 'A2', description: 'MoA / AoA — Verify manufacturing objects clause', required: true, evidenceType: 'original_document' },
        { itemId: 'A3', description: 'Partnership Deed / LLP Agreement (if applicable)', required: false, evidenceType: 'original_document' },
        { itemId: 'A4', description: 'PAN Card (Entity) — Match PAN with GST and bank account name', required: true, evidenceType: 'original_document' },
        { itemId: 'A5', description: 'GSTIN Registration Certificate — Verify GSTIN, category, status on GST portal', required: true, evidenceType: 'portal_screenshot' },
        { itemId: 'A6', description: 'Trade Licence / Shops & Establishment Certificate', required: true, evidenceType: 'original_document' },
        { itemId: 'A7', description: 'IEC (Import Export Code) — if cross-border manufacturing/exports', required: false, evidenceType: 'original_document' },
        { itemId: 'A8', description: 'Factory Licence / Manufacturing Licence (Factories Act)', required: true, evidenceType: 'original_document' },
        { itemId: 'A9', description: 'Pollution Control Board (PCB) Certificate — NOC / Consent to Operate', required: true, evidenceType: 'certificate' },
        { itemId: 'A10', description: 'Bureau of Indian Standards (BIS) / Industry-Specific Certifications', required: false, evidenceType: 'certificate' },
      ],
    },
    {
      sectionId: 'B',
      sectionName: 'Ownership, Directors & UBO',
      items: [
        { itemId: 'B1', description: 'List of Directors / Partners / Proprietor with DINs — cross-check MCA portal', required: true, evidenceType: 'mca_extract' },
        { itemId: 'B2', description: 'KYC of Key Directors / Authorised Signatories — Aadhaar + PAN + Photo', required: false, evidenceType: 'original_document' },
        { itemId: 'B3', description: 'UBO Declaration — Identify individuals owning >10% per PMLA norms', required: true, evidenceType: 'signed_declaration' },
        { itemId: 'B4', description: 'Board Resolution / Authority Letter for contracting', required: true, evidenceType: 'original_document' },
        { itemId: 'B5', description: 'Shareholding Pattern / Ownership Structure Chart', required: false, evidenceType: 'company_provided' },
      ],
    },
    {
      sectionId: 'C',
      sectionName: 'Financial Standing',
      items: [
        { itemId: 'C1', description: 'Audited Financial Statements (Last 2–3 Years)', required: true, evidenceType: 'original_document' },
        { itemId: 'C2', description: 'ITR (Last 2 Years) with Computation', required: true, evidenceType: 'original_document' },
        { itemId: 'C3', description: 'Bank Statement (Last 6 Months) — Banker-Stamped', required: true, evidenceType: 'banker_stamped' },
        { itemId: 'C4', description: 'Bank Account Verification Letter / Cancelled Cheque', required: true, evidenceType: 'original_document' },
        { itemId: 'C5', description: 'Credit Rating / CIBIL Score (Entity)', required: false, evidenceType: 'agency_report' },
        { itemId: 'C6', description: 'GST Returns (Last 6 Months — GSTR-1, GSTR-3B)', required: true, evidenceType: 'portal_screenshot' },
      ],
    },
    {
      sectionId: 'D',
      sectionName: 'Manufacturing Capability & Facility',
      items: [
        { itemId: 'D1', description: 'Factory Site Visit — Physical inspection of production facility, layout, cleanliness, safety', required: true, evidenceType: 'site_visit_photos' },
        { itemId: 'D2', description: 'Production Capacity Statement — Certified by management', required: true, evidenceType: 'onsite_observation' },
        { itemId: 'D3', description: 'Machinery & Equipment List — Serial numbers, age, condition verification onsite', required: true, evidenceType: 'equipment_photos' },
        { itemId: 'D4', description: 'Raw Material Storage Inspection — Verify storage conditions, labelling, segregation', required: true, evidenceType: 'storage_photos' },
        { itemId: 'D5', description: 'WIP (Work-in-Progress) Storage Assessment', required: true, evidenceType: 'storage_photos' },
        { itemId: 'D6', description: 'Finished Goods Warehouse Inspection — Storage conditions, dispatch readiness', required: true, evidenceType: 'warehouse_photos' },
        { itemId: 'D7', description: 'Workforce Headcount Verification — Physical count vs. stated headcount', required: true, evidenceType: 'onsite_observation' },
        { itemId: 'D8', description: 'Utility & Infrastructure Assessment — Power, water, waste management systems', required: true, evidenceType: 'infrastructure_photos' },
        { itemId: 'D9', description: 'Quality Control / Testing Lab Inspection', required: true, evidenceType: 'lab_photos' },
        { itemId: 'D10', description: 'EHS (Environment, Health & Safety) Compliance Onsite Review', required: true, evidenceType: 'ehs_inspection_photos' },
      ],
    },
    {
      sectionId: 'E',
      sectionName: 'Quality & Compliance Certifications',
      items: [
        { itemId: 'E1', description: 'ISO 9001 / ISO 14001 / OHSAS 18001 — Quality & Environmental Management System', required: false, evidenceType: 'certificate' },
        { itemId: 'E2', description: 'BIS / BEE / FSSAI / CDSCO / Other Industry Certification (as applicable)', required: false, evidenceType: 'certificate' },
        { itemId: 'E3', description: 'Labour Law Compliance — PF, ESIC, Minimum Wages, Contract Labour Act', required: true, evidenceType: 'certificate' },
        { itemId: 'E4', description: 'Litigation / Legal Dispute Disclosure', required: true, evidenceType: 'signed_declaration' },
        { itemId: 'E5', description: 'Blacklist / Debarment Check — EPFO, NPCI, CVC databases', required: true, evidenceType: 'database_check' },
        { itemId: 'E6', description: 'Reference Check (2 Buyer/Client References)', required: true, evidenceType: 'reference_verification' },
      ],
    },
    {
      sectionId: 'F',
      sectionName: 'Supply Chain & Contracts',
      items: [
        { itemId: 'F1', description: 'Signed Vendor NDA', required: true, evidenceType: 'original_document' },
        { itemId: 'F2', description: 'Vendor Application / Onboarding Form', required: true, evidenceType: 'original_document' },
        { itemId: 'F3', description: 'Vendor DPA (if handling customer data)', required: false, evidenceType: 'executed_original' },
        { itemId: 'F4', description: 'Purchase Agreement / Rate Contract / SLA', required: true, evidenceType: 'original_document' },
        { itemId: 'F5', description: 'Key Supplier / Sub-contractor Disclosure', required: true, evidenceType: 'onsite_observation' },
        { itemId: 'F7', description: 'Vendor Code Assignment & System Entry', required: true, evidenceType: 'system_record' },
      ],
    },
  ],
};

// ─── Both Vendor Type Template (union of SP + MFG) ────────────────────────────

const BOTH_VENDOR_PHYSICAL = {
  ...SERVICE_PROVIDER_PHYSICAL,
  name: 'Service Provider + Manufacturer — Combined Physical Inspection Checklist',
  vendorType: 'both',
  sections: [
    ...SERVICE_PROVIDER_PHYSICAL.sections,
    ...MANUFACTURER_PHYSICAL.sections.filter(
      (s) => !SERVICE_PROVIDER_PHYSICAL.sections.find((sp) => sp.sectionId === s.sectionId)
    ),
  ],
};

// ─── Seed Function ────────────────────────────────────────────────────────────

const TEMPLATES = [
  SERVICE_PROVIDER_PHYSICAL,
  MANUFACTURER_PHYSICAL,
  BOTH_VENDOR_PHYSICAL,
];

async function seedChecklists() {
  console.log('Seeding Physical KYC checklist templates...\n');

  for (const template of TEMPLATES) {
    const checklistId = uuidv4();
    const now = new Date().toISOString();

    const item = {
      checklistId,
      ...template,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await dynamoDB.put({
        TableName: PHYSICAL_KYC_CHECKLISTS_TABLE,
        ConditionExpression: 'attribute_not_exists(checklistId)',
        Item: item,
      }).promise();

      console.log(`✅ Seeded: [${template.vendorType}] ${template.name}`);
      console.log(`   checklistId: ${checklistId}`);
      console.log(`   Sections: ${template.sections.length}`);
      const totalItems = template.sections.reduce((sum, s) => sum + s.items.length, 0);
      console.log(`   Total items: ${totalItems}\n`);
    } catch (err) {
      if (err.code === 'ConditionalCheckFailedException') {
        console.warn(`⚠️  Skipped (already exists): ${template.name}`);
      } else {
        console.error(`❌ Failed to seed ${template.name}:`, err.message);
        throw err;
      }
    }
  }

  console.log('✅ Physical KYC checklist seeding complete.');
}

seedChecklists().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
