import { useState, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from "recharts";
import { TrendingUp, TrendingDown, Crown, Target, Clock, Mail, Users, Zap, Filter, Calendar } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

interface PriorityAnalyticsDashboardProps {
  accountId?: string;
  className?: string;
}

const COLORS = {
  priority: {
    0: '#9CA3AF', // gray-400
    1: '#3B82F6', // blue-500
    2: '#F59E0B', // amber-500
    3: '#EF4444', // red-500
  }
};

export function PriorityAnalyticsDashboard({ accountId, className }: PriorityAnalyticsDashboardProps) {
  const [timePeriod, setTimePeriod] = useState('30');

  // Fetch priority distribution
  const { data: priorityDistribution = [] } = useQuery({
    queryKey: ['/api/priority/analytics/distribution', { days: timePeriod }],
    select: (data: any[]) => data.map((item: any) => ({
      ...item,
      name: getPriorityName(item.priority),
      fill: COLORS.priority[item.priority as keyof typeof COLORS.priority]
    }))
  }) as { data: any[] };

  // Fetch VIP interaction stats
  const { data: vipStats = [] } = useQuery({
    queryKey: ['/api/priority/analytics/vip-stats', { days: timePeriod }]
  }) as { data: any[] };

  // Fetch rule effectiveness data
  const { data: ruleEffectiveness = [] } = useQuery({
    queryKey: ['/api/priority/analytics/rule-effectiveness', accountId, { days: timePeriod }],
    enabled: !!accountId
  }) as { data: any[] };

  const getPriorityName = (priority: number) => {
    switch (priority) {
      case 0: return 'Low';
      case 1: return 'Normal';
      case 2: return 'High';
      case 3: return 'Critical';
      default: return 'Unknown';
    }
  };

  const getPriorityColor = (priority: number) => {
    switch (priority) {
      case 0: return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200';
      case 1: return 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400';
      case 2: return 'bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-400';
      case 3: return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200';
    }
  };

  // Calculate summary metrics
  const summaryMetrics = useMemo(() => {
    const totalEmails = priorityDistribution.reduce((sum: number, item: any) => sum + item.count, 0);
    const highPriorityEmails = priorityDistribution
      .filter((item: any) => item.priority >= 2)
      .reduce((sum: number, item: any) => sum + item.count, 0);
    const vipEmails = vipStats.reduce((sum: number, vip: any) => sum + vip.interactionCount, 0);
    const activeRules = ruleEffectiveness.filter((rule: any) => rule.effectiveness > 0).length;

    return {
      totalEmails,
      highPriorityEmails,
      vipEmails,
      activeRules,
      priorityRate: totalEmails > 0 ? (highPriorityEmails / totalEmails) * 100 : 0,
      vipRate: totalEmails > 0 ? (vipEmails / totalEmails) * 100 : 0
    };
  }, [priorityDistribution, vipStats, ruleEffectiveness]);

  const formatTooltipValue = (value: number, name: string) => {
    return [`${value} emails`, name];
  };

  const MetricCard = ({ title, value, subtitle, icon: Icon, trend, trendValue }: any) => (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{subtitle}</span>
          {trend && (
            <div className={cn(
              "flex items-center gap-1",
              trend === 'up' ? 'text-green-600' : 'text-red-600'
            )}>
              {trend === 'up' ? (
                <TrendingUp className="h-3 w-3" />
              ) : (
                <TrendingDown className="h-3 w-3" />
              )}
              <span>{trendValue}%</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className={`space-y-6 ${className}`} data-testid="priority-analytics-dashboard">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Priority Analytics</h2>
          <p className="text-muted-foreground">
            Insights into email priority patterns and system performance
          </p>
        </div>
        <Select value={timePeriod} onValueChange={setTimePeriod}>
          <SelectTrigger className="w-48" data-testid="select-time-period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Summary Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total Emails"
          value={summaryMetrics.totalEmails.toLocaleString()}
          subtitle={`Last ${timePeriod} days`}
          icon={Mail}
          data-testid="metric-total-emails"
        />
        <MetricCard
          title="High Priority"
          value={summaryMetrics.highPriorityEmails.toLocaleString()}
          subtitle={`${summaryMetrics.priorityRate.toFixed(1)}% of total`}
          icon={Target}
          data-testid="metric-high-priority"
        />
        <MetricCard
          title="VIP Interactions"
          value={summaryMetrics.vipEmails.toLocaleString()}
          subtitle={`${summaryMetrics.vipRate.toFixed(1)}% of total`}
          icon={Crown}
          data-testid="metric-vip-interactions"
        />
        <MetricCard
          title="Active Rules"
          value={summaryMetrics.activeRules}
          subtitle="Effectively matching emails"
          icon={Filter}
          data-testid="metric-active-rules"
        />
      </div>

      <Tabs defaultValue="distribution" className="space-y-4">
        <TabsList>
          <TabsTrigger value="distribution" data-testid="tab-distribution">Distribution</TabsTrigger>
          <TabsTrigger value="vip-analysis" data-testid="tab-vip-analysis">VIP Analysis</TabsTrigger>
          <TabsTrigger value="rule-performance" data-testid="tab-rule-performance">Rule Performance</TabsTrigger>
        </TabsList>

        <TabsContent value="distribution" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Priority Distribution Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Priority Distribution</CardTitle>
                <CardDescription>
                  Email volume by priority level over the last {timePeriod} days
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={priorityDistribution}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip formatter={formatTooltipValue} />
                    <Bar dataKey="count" fill="#8884d8" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Priority Distribution Pie Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Priority Breakdown</CardTitle>
                <CardDescription>
                  Percentage distribution of email priorities
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={priorityDistribution}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="count"
                    >
                      {priorityDistribution.map((entry: any, index: number) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip formatter={formatTooltipValue} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="vip-analysis" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>VIP Contact Performance</CardTitle>
              <CardDescription>
                Email interaction statistics for your VIP contacts
              </CardDescription>
            </CardHeader>
            <CardContent>
              {vipStats.length === 0 ? (
                <div className="text-center py-8">
                  <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">
                    No VIP interaction data available for the selected period.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {vipStats.slice(0, 10).map((vip: any, index: number) => (
                    <div key={vip.vipId} className="flex items-center justify-between p-3 border rounded-md">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-8 h-8 bg-amber-100 dark:bg-amber-900/20 rounded-full">
                          <Crown className="h-4 w-4 text-amber-600" />
                        </div>
                        <div>
                          <p className="font-medium">{vip.name || vip.email}</p>
                          <p className="text-sm text-muted-foreground">{vip.email}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">{vip.interactionCount}</p>
                        <p className="text-sm text-muted-foreground">interactions</p>
                      </div>
                    </div>
                  ))}
                  {vipStats.length > 10 && (
                    <p className="text-center text-sm text-muted-foreground">
                      And {vipStats.length - 10} more VIP contacts...
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rule-performance" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Priority Rule Effectiveness</CardTitle>
              <CardDescription>
                Performance metrics for your custom priority rules
              </CardDescription>
            </CardHeader>
            <CardContent>
              {ruleEffectiveness.length === 0 ? (
                <div className="text-center py-8">
                  <Zap className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">
                    No rule performance data available. Create some priority rules to see analytics.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {ruleEffectiveness.map((rule: any) => (
                    <div key={rule.ruleId} className="flex items-center justify-between p-4 border rounded-md">
                      <div className="flex-1">
                        <h4 className="font-medium">{rule.name}</h4>
                        <div className="flex items-center gap-4 mt-2">
                          <div className="flex items-center gap-2">
                            <Target className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">
                              {rule.matchCount} matches
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">
                              {rule.effectiveness.toFixed(1)}% effective
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge 
                          variant={rule.effectiveness > 50 ? "default" : rule.effectiveness > 20 ? "secondary" : "outline"}
                          className={cn(
                            rule.effectiveness > 50 && "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400",
                            rule.effectiveness <= 20 && "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400"
                          )}
                        >
                          {rule.effectiveness > 50 ? 'High' : rule.effectiveness > 20 ? 'Medium' : 'Low'} Performance
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Insights and Recommendations */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Insights & Recommendations
          </CardTitle>
          <CardDescription>
            AI-powered insights to optimize your email priority system
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {summaryMetrics.priorityRate > 50 && (
              <div className="flex items-start gap-3 p-3 bg-orange-50 dark:bg-orange-900/10 border border-orange-200 dark:border-orange-800 rounded-md">
                <TrendingUp className="h-4 w-4 text-orange-600 mt-0.5" />
                <div>
                  <p className="font-medium text-orange-900 dark:text-orange-100">High Priority Rate Detected</p>
                  <p className="text-sm text-orange-700 dark:text-orange-300">
                    {summaryMetrics.priorityRate.toFixed(1)}% of your emails are high priority. Consider refining your rules to reduce noise.
                  </p>
                </div>
              </div>
            )}
            
            {summaryMetrics.vipRate > 0 && (
              <div className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 rounded-md">
                <Crown className="h-4 w-4 text-blue-600 mt-0.5" />
                <div>
                  <p className="font-medium text-blue-900 dark:text-blue-100">VIP Engagement</p>
                  <p className="text-sm text-blue-700 dark:text-blue-300">
                    {summaryMetrics.vipRate.toFixed(1)}% of your emails are from VIP contacts. Great job managing important relationships!
                  </p>
                </div>
              </div>
            )}

            {summaryMetrics.activeRules === 0 && (
              <div className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-900/10 border border-gray-200 dark:border-gray-800 rounded-md">
                <Filter className="h-4 w-4 text-gray-600 mt-0.5" />
                <div>
                  <p className="font-medium text-gray-900 dark:text-gray-100">No Active Rules</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    Consider creating priority rules to automatically classify your emails and save time.
                  </p>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}