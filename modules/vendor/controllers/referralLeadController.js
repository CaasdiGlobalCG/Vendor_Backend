import { DynamoDBClient, PutItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { v4 as uuidv4 } from 'uuid';

const dbClient = new DynamoDBClient({ region: process.env.AWS_REGION });

const TABLE_NAME = process.env.REFERRAL_LEADS_TABLE || 'referral_leads';

const parseLimit = (value, fallback) => {
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 100);
};

const decodeNextToken = (nextToken) => {
  if (!nextToken) return null;
  try {
    return JSON.parse(Buffer.from(String(nextToken), 'base64').toString());
  } catch {
    return null;
  }
};

const encodeNextToken = (lastEvaluatedKey) => {
  if (!lastEvaluatedKey) return null;
  return Buffer.from(JSON.stringify(lastEvaluatedKey)).toString('base64');
};

const validatePayload = (body) => {
  if (!body || typeof body !== 'object') return 'Invalid request body';

  const { referrerVendorId, leadType, contact, project } = body;

  if (!referrerVendorId || typeof referrerVendorId !== 'string') {
    return 'referrerVendorId is required';
  }

  const allowedTypes = new Set(['vendor', 'client', 'project', 'other']);
  if (!leadType || !allowedTypes.has(String(leadType))) {
    return 'leadType must be one of: vendor, client, project, other';
  }

  const contactName = contact?.name;
  const contactEmail = contact?.email;
  const contactPhone = contact?.phone;

  if (!contactName || typeof contactName !== 'string' || !contactName.trim()) {
    return 'contact.name is required';
  }

  if ((!contactEmail || !String(contactEmail).trim()) && (!contactPhone || !String(contactPhone).trim())) {
    return 'Provide at least contact.email or contact.phone';
  }

  if (String(leadType) === 'project') {
    const projectName = project?.name;
    if (!projectName || typeof projectName !== 'string' || !projectName.trim()) {
      return 'project.name is required for project leads';
    }
  }

  return null;
};

export const createReferralLead = async (req, res) => {
  try {
    const validationError = validatePayload(req.body);
    if (validationError) {
      return res.status(400).json({ success: false, error: validationError });
    }

    const now = new Date().toISOString();
    const leadId = uuidv4();

    const incomingCreatedAt = typeof req.body.createdAt === 'string' && req.body.createdAt ? req.body.createdAt : null;

    const item = {
      leadId,
      referrerVendorId: String(req.body.referrerVendorId),
      leadType: String(req.body.leadType),
      status: 'new',
      source: 'vendor_portal',
      contact: {
        name: String(req.body.contact?.name || '').trim(),
        email: req.body.contact?.email ? String(req.body.contact.email).trim() : null,
        phone: req.body.contact?.phone ? String(req.body.contact.phone).trim() : null,
      },
      companyName: req.body.companyName ? String(req.body.companyName).trim() : null,
      location: req.body.location ? String(req.body.location).trim() : null,
      project: req.body.project && typeof req.body.project === 'object'
        ? {
            name: req.body.project?.name ? String(req.body.project.name).trim() : null,
            description: req.body.project?.description ? String(req.body.project.description).trim() : null,
            estimatedBudget: req.body.project?.estimatedBudget ? String(req.body.project.estimatedBudget).trim() : null,
            timeline: req.body.project?.timeline ? String(req.body.project.timeline).trim() : null,
          }
        : null,
      notes: req.body.notes ? String(req.body.notes).trim() : null,
      createdAt: incomingCreatedAt || now,
      updatedAt: now,
    };

    // Table schema (recommended):
    //   PK  referrerVendorId (S)
    //   SK  createdAt (S)
    // Optional GSI: LeadIdIndex (PK: leadId)
    const params = {
      TableName: TABLE_NAME,
      Item: marshall(item, { removeUndefinedValues: true }),
      ConditionExpression: 'attribute_not_exists(referrerVendorId) AND attribute_not_exists(createdAt)',
    };

    await dbClient.send(new PutItemCommand(params));

    return res.status(201).json({ success: true, leadId, lead: item });
  } catch (error) {
    console.error('❌ Error creating referral lead:', error);

    // Useful DynamoDB error surface
    const message = error?.message || 'Failed to create referral lead';
    return res.status(500).json({ success: false, error: message });
  }
};

export const listReferralLeadsByReferrer = async (req, res) => {
  try {
    const { referrerVendorId, nextToken } = req.query;
    const limit = parseLimit(req.query.limit, 20);

    if (!referrerVendorId || typeof referrerVendorId !== 'string') {
      return res.status(400).json({ success: false, error: 'referrerVendorId query param is required' });
    }

    const exclusiveStartKey = decodeNextToken(nextToken);

    const params = {
      TableName: TABLE_NAME,
      KeyConditionExpression: 'referrerVendorId = :v',
      ExpressionAttributeValues: marshall({
        ':v': String(referrerVendorId),
      }),
      Limit: limit,
      ScanIndexForward: false,
    };

    if (exclusiveStartKey) {
      params.ExclusiveStartKey = exclusiveStartKey;
    }

    const result = await dbClient.send(new QueryCommand(params));

    const leads = (result.Items || []).map((item) => unmarshall(item));
    const responseNextToken = encodeNextToken(result.LastEvaluatedKey);

    return res.json({
      success: true,
      leads,
      nextToken: responseNextToken,
      hasMore: Boolean(result.LastEvaluatedKey),
    });
  } catch (error) {
    console.error('❌ Error listing referral leads:', error);
    const message = error?.message || 'Failed to list referral leads';
    return res.status(500).json({ success: false, error: message });
  }
};
