// ============================================================
// FILE: permissionsController.js
// PURPOSE: API handler for the rbac_permissions catalog table.
//          Returns the full list of available permissions per platform,
//          grouped by resource and category. Used by:
//          - Role editor UI (list checkboxes for permission assignment)
//          - "My Permissions" page (human-readable descriptions)
//          - Validation (ensure permission strings are real)
// CONNECTS TO: rbac_permissions table, meController (cross-ref)
// ============================================================

import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../config/db.js';
import { TABLES } from '../config/tables.js';

/**
 * GET /api/rbac/permissions?platform=vendor
 *
 * Lists all registered permissions for a given platform,
 * grouped by resource (module) and category.
 *
 * Query params:
 *   platform (required) — 'vendor' | 'client' | 'sales'
 *
 * Response shape:
 * {
 *   platform: 'vendor',
 *   permissions: [
 *     { permissionId: 'products:view', resource: 'products', action: 'view', ... }
 *   ],
 *   grouped: {
 *     core: {
 *       dashboard: [{ permissionId, action, description, ... }],
 *       products: [...]
 *     },
 *     sales: { ... }
 *   },
 *   total: 95
 * }
 */
export async function listPermissions(req, res) {
  try {
    const platform = req.query.platform || req.rbac?.orgType || 'vendor';
    const validPlatforms = ['vendor', 'client', 'sales'];

    if (!validPlatforms.includes(platform)) {
      return res.status(400).json({
        error: `Invalid platform. Must be one of: ${validPlatforms.join(', ')}`,
      });
    }

    // Query all permissions for the platform (PK = platform)
    const items = [];
    let lastKey = undefined;

    do {
      const result = await docClient.send(new QueryCommand({
        TableName: TABLES.PERMISSIONS,
        KeyConditionExpression: 'platform = :p',
        ExpressionAttributeValues: { ':p': platform },
        ExclusiveStartKey: lastKey,
      }));
      items.push(...(result.Items || []));
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    // Group by category → resource for the UI
    const grouped = {};
    for (const perm of items) {
      const cat = perm.category || 'general';
      if (!grouped[cat]) grouped[cat] = {};
      if (!grouped[cat][perm.resource]) grouped[cat][perm.resource] = [];
      grouped[cat][perm.resource].push({
        permissionId: perm.permissionId,
        action: perm.action,
        label: perm.label,
        description: perm.description,
      });
    }

    // Sort actions within each resource for consistent UI
    const actionOrder = ['view', 'create', 'edit', 'delete', 'export', 'manage'];
    for (const cat of Object.values(grouped)) {
      for (const resource of Object.keys(cat)) {
        cat[resource].sort((a, b) =>
          actionOrder.indexOf(a.action) - actionOrder.indexOf(b.action)
        );
      }
    }

    return res.status(200).json({
      platform,
      permissions: items.map(p => ({
        permissionId: p.permissionId,
        resource: p.resource,
        action: p.action,
        label: p.label,
        description: p.description,
        category: p.category,
      })),
      grouped,
      total: items.length,
    });
  } catch (error) {
    console.error('[RBAC] listPermissions error:', error);
    return res.status(500).json({ error: 'Failed to list permissions' });
  }
}

/**
 * GET /api/rbac/permissions/platforms
 *
 * Returns metadata about all available platforms.
 * Used by the invite modal to show platform checkboxes.
 */
export async function listPlatforms(req, res) {
  try {
    const platforms = [
      {
        key: 'vendor',
        label: 'Vendor Dashboard',
        description: 'Products, orders, CRM, quotations, shipments',
      },
      {
        key: 'client',
        label: 'Client Dashboard',
        description: 'Projects, billing, documents, workspace',
      },
      {
        key: 'sales',
        label: 'Sales (B2B)',
        description: 'Enquiries, orders, products, shipments',
      },
    ];

    return res.status(200).json({ platforms });
  } catch (error) {
    console.error('[RBAC] listPlatforms error:', error);
    return res.status(500).json({ error: 'Failed to list platforms' });
  }
}
