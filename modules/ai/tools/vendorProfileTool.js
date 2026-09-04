// ============================================================
// FILE: modules/ai/tools/vendorProfileTool.js
// PURPOSE: LangChain tools for querying vendor profile, products,
//          services, customers, and team info.
// ============================================================

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'ap-south-1' });
const docClient = DynamoDBDocumentClient.from(ddbClient);

export function createVendorProfileTools(vendorId) {
  const getVendorProfile = new DynamicStructuredTool({
    name: 'getVendorProfile',
    description:
      'Get the current vendor\'s profile information — company details, contact info, registration status, compliance.',
    schema: z.object({}),
    func: async () => {
      try {
        console.log(`[AI][VendorProfileTool] getVendorProfile called for vendorId="${vendorId}"`);
        const result = await docClient.send(
          new GetCommand({
            TableName: 'vendors',
            Key: { vendorId },
          })
        );
        const v = result.Item;
        console.log(`[AI][VendorProfileTool] Vendor found: ${!!v}`);
        if (!v) return JSON.stringify({ error: 'Vendor profile not found' });

        const profile = {
          vendorId: v.vendorId,
          email: v.email,
          status: v.status || 'pending',
          vendorDetails: {
            firstName: v.vendorDetails?.firstName,
            lastName: v.vendorDetails?.lastName,
            vendorName: v.vendorDetails?.vendorName,
            companyName: v.vendorDetails?.companyName,
            phone: v.vendorDetails?.phone,
          },
          companyDetails: {
            companyName: v.companyDetails?.companyName,
            industry: v.companyDetails?.industry,
            gstNumber: v.companyDetails?.gstNumber,
            panNumber: v.companyDetails?.panNumber,
            address: v.companyDetails?.address,
          },
          registeredAt: v.createdAt,
        };
        return JSON.stringify(profile);
      } catch (err) {
        return JSON.stringify({ error: err.message });
      }
    },
  });

  const getProducts = new DynamicStructuredTool({
    name: 'getProducts',
    description: 'Get the product catalog for this vendor.',
    schema: z.object({}),
    func: async () => {
      try {
        const result = await docClient.send(
          new QueryCommand({
            TableName: 'Products',
            KeyConditionExpression: 'vendorId = :vid',
            ExpressionAttributeValues: { ':vid': vendorId },
          })
        );
        const products = (result.Items || []).map((p) => ({
          productId: p.productId,
          name: p.name || p.productName || 'Unnamed',
          description: p.description,
          price: p.price,
          category: p.category,
        }));
        return JSON.stringify({ count: products.length, products });
      } catch (err) {
        return JSON.stringify({ error: err.message });
      }
    },
  });

  const getCustomers = new DynamicStructuredTool({
    name: 'getCustomers',
    description: 'Get the customer list for this vendor.',
    schema: z.object({}),
    func: async () => {
      try {
        const result = await docClient.send(
          new QueryCommand({
            TableName: 'workspace_customers',
            KeyConditionExpression: 'vendorId = :vid',
            ExpressionAttributeValues: { ':vid': vendorId },
          })
        );
        const customers = (result.Items || []).map((c) => ({
          customerId: c.customerId,
          name: c.name || c.customerName || 'Unnamed',
          email: c.email,
          companyName: c.companyName,
          phone: c.phone,
        }));
        return JSON.stringify({ count: customers.length, customers });
      } catch (err) {
        return JSON.stringify({ error: err.message });
      }
    },
  });

  const getNotifications = new DynamicStructuredTool({
    name: 'getNotifications',
    description: 'Get recent notifications for this vendor — unread count, titles, types.',
    schema: z.object({
      unreadOnly: z.boolean().optional().describe('If true, return only unread notifications'),
    }),
    func: async ({ unreadOnly }) => {
      try {
        const filterExpr = unreadOnly
          ? 'userId = :vid AND isRead = :false'
          : 'userId = :vid';
        const exprVals = { ':vid': vendorId };
        if (unreadOnly) exprVals[':false'] = false;

        const result = await docClient.send(
          new ScanCommand({
            TableName: 'notifications',
            FilterExpression: filterExpr,
            ExpressionAttributeValues: exprVals,
          })
        );
        const notifs = (result.Items || [])
          .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
          .slice(0, 20)
          .map((n) => ({
            notificationId: n.notificationId,
            title: n.title,
            message: n.message,
            type: n.type,
            isRead: n.isRead,
            createdAt: n.createdAt,
          }));
        return JSON.stringify({
          count: notifs.length,
          unreadCount: notifs.filter((n) => !n.isRead).length,
          notifications: notifs,
        });
      } catch (err) {
        return JSON.stringify({ error: err.message });
      }
    },
  });

  const getTeamMembers = new DynamicStructuredTool({
    name: 'getTeamMembers',
    description: 'Get RBAC team members for this vendor\'s organization.',
    schema: z.object({}),
    func: async () => {
      try {
        // vendorId is the orgId in RBAC context
        const result = await docClient.send(
          new ScanCommand({
            TableName: 'rbac_members',
            FilterExpression: 'orgId = :oid',
            ExpressionAttributeValues: { ':oid': vendorId },
          })
        );
        const members = (result.Items || []).map((m) => ({
          userId: m.userId,
          email: m.email,
          role: m.roleName || m.roleId,
          status: m.status || 'active',
          joinedAt: m.joinedAt || m.createdAt,
        }));
        return JSON.stringify({ count: members.length, members });
      } catch (err) {
        return JSON.stringify({ error: err.message });
      }
    },
  });

  return [getVendorProfile, getProducts, getCustomers, getNotifications, getTeamMembers];
}
