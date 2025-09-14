import { useState, useEffect } from "react";
import { Plus, X, ChevronUp, ChevronDown, Settings, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { PriorityRule } from "@shared/schema";

interface RuleCondition {
  field: 'from' | 'to' | 'subject' | 'body' | 'hasAttachments';
  operator: 'contains' | 'equals' | 'startsWith' | 'endsWith' | 'regex' | 'domain';
  value: string;
  caseSensitive?: boolean;
}

interface RuleBuilder {
  logic: 'AND' | 'OR';
  rules: RuleCondition[];
}

interface PriorityRulesBuilderProps {
  accountId: string;
}

export function PriorityRulesBuilder({ accountId }: PriorityRulesBuilderProps) {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<PriorityRule | null>(null);
  const [newRule, setNewRule] = useState({
    name: '',
    description: '',
    priority: 1,
    isActive: true,
    executionOrder: 0,
    conditions: {
      logic: 'AND' as const,
      rules: [{ field: 'from' as const, operator: 'contains' as const, value: '', caseSensitive: false }]
    }
  });

  // Fetch priority rules
  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['/api/priority/rules', accountId],
    enabled: !!accountId
  }) as { data: PriorityRule[]; isLoading: boolean };

  // Create rule mutation
  const createRuleMutation = useMutation({
    mutationFn: async (ruleData: any) => {
      const response = await apiRequest('POST', '/api/priority/rules', {
        ...ruleData,
        accountId,
        conditionsJson: JSON.stringify(ruleData.conditions)
      });
      return response.json();
    },
    onError: (error: any) => {
      toast({ title: "Failed to create rule", description: error.message, variant: "destructive" });
    }
  });

  useEffect(() => {
    if (createRuleMutation.isSuccess) {
      queryClient.invalidateQueries({ queryKey: ['/api/priority/rules', accountId] });
      toast({ title: "Priority rule created successfully" });
      setIsDialogOpen(false);
      resetNewRule();
    }
  }, [createRuleMutation.isSuccess, accountId]);

  // Update rule mutation
  const updateRuleMutation = useMutation({
    mutationFn: async ({ ruleId, updates }: { ruleId: string; updates: any }) => {
      const response = await apiRequest('PUT', `/api/priority/rules/${ruleId}`, {
        ...updates,
        conditionsJson: updates.conditions ? JSON.stringify(updates.conditions) : undefined
      });
      return response.json();
    },
    onError: (error: any) => {
      toast({ title: "Failed to update rule", description: error.message, variant: "destructive" });
    }
  });

  useEffect(() => {
    if (updateRuleMutation.isSuccess) {
      queryClient.invalidateQueries({ queryKey: ['/api/priority/rules', accountId] });
      toast({ title: "Priority rule updated successfully" });
      setEditingRule(null);
    }
  }, [updateRuleMutation.isSuccess, accountId]);

  // Delete rule mutation
  const deleteRuleMutation = useMutation({
    mutationFn: async (ruleId: string) => {
      const response = await apiRequest('DELETE', `/api/priority/rules/${ruleId}`);
      return response.json();
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete rule", description: error.message, variant: "destructive" });
    }
  });

  useEffect(() => {
    if (deleteRuleMutation.isSuccess) {
      queryClient.invalidateQueries({ queryKey: ['/api/priority/rules', accountId] });
      toast({ title: "Priority rule deleted successfully" });
    }
  }, [deleteRuleMutation.isSuccess, accountId]);

  // Reorder rules mutation
  const reorderRulesMutation = useMutation({
    mutationFn: async (ruleUpdates: Array<{ id: string; executionOrder: number }>) => {
      const response = await apiRequest('POST', '/api/priority/rules/reorder', { ruleUpdates });
      return response.json();
    },
    onError: (error: any) => {
      toast({ title: "Failed to reorder rules", description: error.message, variant: "destructive" });
    }
  });

  useEffect(() => {
    if (reorderRulesMutation.isSuccess) {
      queryClient.invalidateQueries({ queryKey: ['/api/priority/rules', accountId] });
      toast({ title: "Rules reordered successfully" });
    }
  }, [reorderRulesMutation.isSuccess, accountId]);

  const resetNewRule = () => {
    setNewRule({
      name: '',
      description: '',
      priority: 1,
      isActive: true,
      executionOrder: rules.length,
      conditions: {
        logic: 'AND',
        rules: [{ field: 'from', operator: 'contains', value: '', caseSensitive: false }]
      }
    });
  };

  const addCondition = (ruleData: any, setRuleData: any) => {
    const newCondition: RuleCondition = {
      field: 'from',
      operator: 'contains',
      value: '',
      caseSensitive: false
    };
    
    setRuleData({
      ...ruleData,
      conditions: {
        ...ruleData.conditions,
        rules: [...ruleData.conditions.rules, newCondition]
      }
    });
  };

  const removeCondition = (index: number, ruleData: any, setRuleData: any) => {
    if (ruleData.conditions.rules.length <= 1) return;
    
    setRuleData({
      ...ruleData,
      conditions: {
        ...ruleData.conditions,
        rules: ruleData.conditions.rules.filter((_: any, i: number) => i !== index)
      }
    });
  };

  const updateCondition = (index: number, updates: Partial<RuleCondition>, ruleData: any, setRuleData: any) => {
    const updatedRules = [...ruleData.conditions.rules];
    updatedRules[index] = { ...updatedRules[index], ...updates };
    
    setRuleData({
      ...ruleData,
      conditions: {
        ...ruleData.conditions,
        rules: updatedRules
      }
    });
  };

  const moveRule = (ruleId: string, direction: 'up' | 'down') => {
    const sortedRules = [...rules].sort((a, b) => (a.executionOrder || 0) - (b.executionOrder || 0));
    const currentIndex = sortedRules.findIndex(r => r.id === ruleId);
    
    if (
      (direction === 'up' && currentIndex === 0) ||
      (direction === 'down' && currentIndex === sortedRules.length - 1)
    ) {
      return;
    }

    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    const ruleUpdates = sortedRules.map((rule, index) => {
      let newOrder = index;
      if (index === currentIndex) {
        newOrder = newIndex;
      } else if (index === newIndex) {
        newOrder = currentIndex;
      }
      return { id: rule.id, executionOrder: newOrder };
    });

    reorderRulesMutation.mutate(ruleUpdates);
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

  const getPriorityText = (priority: number) => {
    switch (priority) {
      case 0: return 'Low';
      case 1: return 'Normal';
      case 2: return 'High';
      case 3: return 'Critical';
      default: return 'Normal';
    }
  };

  const RuleConditionsBuilder = ({ ruleData, setRuleData }: { ruleData: any; setRuleData: any }) => (
    <div className="space-y-4" data-testid="rule-conditions-builder">
      <div className="flex items-center gap-2">
        <Label>Logic:</Label>
        <Select
          value={ruleData.conditions.logic}
          onValueChange={(value: 'AND' | 'OR') => 
            setRuleData({
              ...ruleData,
              conditions: { ...ruleData.conditions, logic: value }
            })
          }
        >
          <SelectTrigger className="w-24" data-testid="select-logic">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="AND">AND</SelectItem>
            <SelectItem value="OR">OR</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {ruleData.conditions.logic === 'AND' ? 'All conditions must match' : 'Any condition can match'}
        </span>
      </div>

      <div className="space-y-3">
        {ruleData.conditions.rules.map((condition: RuleCondition, index: number) => (
          <Card key={index} className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
              <div>
                <Label>Field</Label>
                <Select
                  value={condition.field}
                  onValueChange={(value: any) => updateCondition(index, { field: value }, ruleData, setRuleData)}
                >
                  <SelectTrigger data-testid={`select-field-${index}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="from">From</SelectItem>
                    <SelectItem value="to">To</SelectItem>
                    <SelectItem value="subject">Subject</SelectItem>
                    <SelectItem value="body">Body</SelectItem>
                    <SelectItem value="hasAttachments">Has Attachments</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Operator</Label>
                <Select
                  value={condition.operator}
                  onValueChange={(value: any) => updateCondition(index, { operator: value }, ruleData, setRuleData)}
                >
                  <SelectTrigger data-testid={`select-operator-${index}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="contains">Contains</SelectItem>
                    <SelectItem value="equals">Equals</SelectItem>
                    <SelectItem value="startsWith">Starts With</SelectItem>
                    <SelectItem value="endsWith">Ends With</SelectItem>
                    <SelectItem value="domain">Domain</SelectItem>
                    <SelectItem value="regex">Regex</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Value</Label>
                {condition.field === 'hasAttachments' ? (
                  <Select
                    value={condition.value}
                    onValueChange={(value) => updateCondition(index, { value }, ruleData, setRuleData)}
                  >
                    <SelectTrigger data-testid={`select-value-${index}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">Yes</SelectItem>
                      <SelectItem value="false">No</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={condition.value}
                    onChange={(e) => updateCondition(index, { value: e.target.value }, ruleData, setRuleData)}
                    placeholder="Enter value..."
                    data-testid={`input-value-${index}`}
                  />
                )}
              </div>

              <div className="flex items-center gap-2">
                {condition.field !== 'hasAttachments' && (
                  <div className="flex items-center space-x-2">
                    <Switch
                      checked={condition.caseSensitive || false}
                      onCheckedChange={(checked) => updateCondition(index, { caseSensitive: checked }, ruleData, setRuleData)}
                      data-testid={`switch-case-sensitive-${index}`}
                    />
                    <Label className="text-xs">Case sensitive</Label>
                  </div>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => removeCondition(index, ruleData, setRuleData)}
                  disabled={ruleData.conditions.rules.length <= 1}
                  data-testid={`button-remove-condition-${index}`}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Button
        variant="outline"
        onClick={() => addCondition(ruleData, setRuleData)}
        className="w-full"
        data-testid="button-add-condition"
      >
        <Plus className="h-4 w-4 mr-2" />
        Add Condition
      </Button>
    </div>
  );

  if (isLoading) {
    return <div>Loading priority rules...</div>;
  }

  const sortedRules = [...rules].sort((a, b) => (a.executionOrder || 0) - (b.executionOrder || 0));

  return (
    <div className="space-y-6" data-testid="priority-rules-builder">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Priority Rules</h2>
          <p className="text-muted-foreground">
            Create and manage email priority rules to automatically classify your emails
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-rule">
              <Plus className="h-4 w-4 mr-2" />
              Create Rule
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Priority Rule</DialogTitle>
              <DialogDescription>
                Define conditions that will automatically assign priority levels to incoming emails
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="rule-name">Rule Name</Label>
                  <Input
                    id="rule-name"
                    value={newRule.name}
                    onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
                    placeholder="Enter rule name..."
                    data-testid="input-rule-name"
                  />
                </div>
                <div>
                  <Label htmlFor="rule-priority">Priority Level</Label>
                  <Select
                    value={newRule.priority.toString()}
                    onValueChange={(value) => setNewRule({ ...newRule, priority: parseInt(value) })}
                  >
                    <SelectTrigger data-testid="select-rule-priority">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Low Priority (0)</SelectItem>
                      <SelectItem value="1">Normal Priority (1)</SelectItem>
                      <SelectItem value="2">High Priority (2)</SelectItem>
                      <SelectItem value="3">Critical Priority (3)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label htmlFor="rule-description">Description (Optional)</Label>
                <Input
                  id="rule-description"
                  value={newRule.description}
                  onChange={(e) => setNewRule({ ...newRule, description: e.target.value })}
                  placeholder="Describe what this rule does..."
                  data-testid="input-rule-description"
                />
              </div>

              <Separator />

              <div>
                <h3 className="text-lg font-medium mb-4">Rule Conditions</h3>
                <RuleConditionsBuilder ruleData={newRule} setRuleData={setNewRule} />
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  checked={newRule.isActive}
                  onCheckedChange={(checked) => setNewRule({ ...newRule, isActive: checked })}
                  data-testid="switch-rule-active"
                />
                <Label>Rule is active</Label>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => createRuleMutation.mutate(newRule)}
                  disabled={!newRule.name || createRuleMutation.isPending}
                  data-testid="button-save-rule"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {createRuleMutation.isPending ? 'Creating...' : 'Create Rule'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <ScrollArea className="h-[600px]">
        <div className="space-y-4">
          {sortedRules.length === 0 ? (
            <Card className="p-8 text-center">
              <div className="mx-auto w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                <Settings className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium mb-2">No Priority Rules</h3>
              <p className="text-muted-foreground mb-4">
                Create your first priority rule to automatically classify emails
              </p>
              <Button onClick={() => setIsDialogOpen(true)} data-testid="button-create-first-rule">
                <Plus className="h-4 w-4 mr-2" />
                Create Your First Rule
              </Button>
            </Card>
          ) : (
            sortedRules.map((rule, index) => (
              <Card key={rule.id} className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => moveRule(rule.id, 'up')}
                        disabled={index === 0}
                        data-testid={`button-move-up-${rule.id}`}
                      >
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => moveRule(rule.id, 'down')}
                        disabled={index === sortedRules.length - 1}
                        data-testid={`button-move-down-${rule.id}`}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </div>
                    <div>
                      <h3 className="font-medium">{rule.name}</h3>
                      {rule.description && (
                        <p className="text-sm text-muted-foreground">{rule.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={getPriorityColor(rule.priority)}>
                      {getPriorityText(rule.priority)}
                    </Badge>
                    <Badge variant={rule.isActive ? "default" : "secondary"}>
                      {rule.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => updateRuleMutation.mutate({
                        ruleId: rule.id,
                        updates: { isActive: !rule.isActive }
                      })}
                      data-testid={`button-toggle-${rule.id}`}
                    >
                      <Switch checked={rule.isActive || false} disabled />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteRuleMutation.mutate(rule.id)}
                      data-testid={`button-delete-${rule.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="text-sm text-muted-foreground">
                  <p>
                    <strong>Match Count:</strong> {rule.matchCount || 0} emails
                    {rule.lastMatched && (
                      <span className="ml-4">
                        <strong>Last Matched:</strong> {new Date(rule.lastMatched).toLocaleDateString()}
                      </span>
                    )}
                  </p>
                </div>
              </Card>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}