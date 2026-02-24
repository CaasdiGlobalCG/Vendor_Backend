// ============================================================
// FILE: plans.js
// PURPOSE: Subscription plan definitions. Seeded into rbac_subscription_plans.
// CONNECTS TO: seedDefaults.js (writes these to DynamoDB),
//              org.service.js (checks seat limits)
// ============================================================

/**
 * Subscription plans that gate team size and features.
 * To add a new plan: add an entry here, then re-run seedDefaults.js.
 */
export const PLANS = [
  {
    planId: 'free',
    planName: 'Free',
    maxSeats: 3,
    price: 0,
    // Max custom roles allowed ON TOP of system defaults
    maxCustomRoles: { vendor: 8, client: 4 },
    features: [
      'basic_team_management',
      'default_roles',
      'custom_roles',
    ],
  },
  {
    planId: 'pro',
    planName: 'Pro',
    maxSeats: 10,
    price: 49,
    maxCustomRoles: { vendor: 20, client: 12 },
    features: [
      'basic_team_management',
      'default_roles',
      'custom_roles',
      'extended_audit',
      'priority_support',
    ],
  },
  {
    planId: 'enterprise',
    planName: 'Enterprise',
    maxSeats: 9999,  // Effectively unlimited
    price: 199,
    maxCustomRoles: { vendor: 9999, client: 9999 },
    features: [
      'basic_team_management',
      'default_roles',
      'custom_roles',
      'extended_audit',
      'priority_support',
      'dedicated_support',
      'sla',
      'sso',
    ],
  },
];
