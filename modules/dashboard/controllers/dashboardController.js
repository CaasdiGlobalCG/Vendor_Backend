// Basic vendor dashboard controller stubs
export const getDashboardStats = (req, res) => {
  res.json({ success: true, stats: {} });
};

export const getDashboardSales = (req, res) => {
  res.json({ success: true, sales: [] });
};

export const getDashboardRecentPayments = (req, res) => {
  res.json({ success: true, recentPayments: [] });
};

export const getDashboardTopCustomers = (req, res) => {
  res.json({ success: true, topCustomers: [] });
};

export const getDashboardRecentActivity = (req, res) => {
  res.json({ success: true, recentActivity: [] });
};

export const getDashboardUpcomingPayments = (req, res) => {
  res.json({ success: true, upcomingPayments: [] });
};
