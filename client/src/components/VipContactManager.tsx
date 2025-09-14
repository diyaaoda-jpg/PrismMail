import { useState, useEffect } from "react";
import { Search, Plus, Star, Users, Building2, Crown, Trash2, Edit2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { VipContact } from "@shared/schema";

interface VipContactManagerProps {
  className?: string;
}

interface VipContactForm {
  email: string;
  name: string;
  organization?: string;
  priority: number;
  vipGroup?: string;
  notes?: string;
  photoUrl?: string;
}

export function VipContactManager({ className }: VipContactManagerProps) {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<VipContact | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('all');
  const [newContact, setNewContact] = useState<VipContactForm>({
    email: '',
    name: '',
    organization: '',
    priority: 2,
    vipGroup: '',
    notes: '',
    photoUrl: ''
  });

  // Fetch VIP contacts
  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ['/api/vip/contacts']
  }) as { data: VipContact[]; isLoading: boolean };

  // Fetch VIP suggestions
  const { data: suggestions = [] } = useQuery({
    queryKey: ['/api/vip/suggestions'],
    refetchInterval: 30000 // Refresh suggestions every 30 seconds
  }) as { data: any[] };

  // Create VIP contact mutation
  const createVipMutation = useMutation({
    mutationFn: async (contactData: VipContactForm) => {
      const response = await apiRequest('POST', '/api/vip/contacts', contactData);
      return response.json();
    },
    onError: (error: any) => {
      toast({ title: "Failed to create VIP contact", description: error.message, variant: "destructive" });
    }
  });

  useEffect(() => {
    if (createVipMutation.isSuccess) {
      queryClient.invalidateQueries({ queryKey: ['/api/vip/contacts'] });
      toast({ title: "VIP contact created successfully" });
      setIsDialogOpen(false);
      resetForm();
    }
  }, [createVipMutation.isSuccess]);

  // Update VIP contact mutation
  const updateVipMutation = useMutation({
    mutationFn: async ({ contactId, updates }: { contactId: string; updates: Partial<VipContactForm> }) => {
      const response = await apiRequest('PUT', `/api/vip/contacts/${contactId}`, updates);
      return response.json();
    },
    onError: (error: any) => {
      toast({ title: "Failed to update VIP contact", description: error.message, variant: "destructive" });
    }
  });

  useEffect(() => {
    if (updateVipMutation.isSuccess) {
      queryClient.invalidateQueries({ queryKey: ['/api/vip/contacts'] });
      toast({ title: "VIP contact updated successfully" });
      setEditingContact(null);
    }
  }, [updateVipMutation.isSuccess]);

  // Delete VIP contact mutation
  const deleteVipMutation = useMutation({
    mutationFn: async (contactId: string) => {
      const response = await apiRequest('DELETE', `/api/vip/contacts/${contactId}`);
      return response.json();
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete VIP contact", description: error.message, variant: "destructive" });
    }
  });

  useEffect(() => {
    if (deleteVipMutation.isSuccess) {
      queryClient.invalidateQueries({ queryKey: ['/api/vip/contacts'] });
      toast({ title: "VIP contact deleted successfully" });
    }
  }, [deleteVipMutation.isSuccess]);

  const resetForm = () => {
    setNewContact({
      email: '',
      name: '',
      organization: '',
      priority: 2,
      vipGroup: '',
      notes: '',
      photoUrl: ''
    });
  };

  const openEditDialog = (contact: VipContact) => {
    setEditingContact(contact);
    setNewContact({
      email: contact.email,
      name: contact.name || '',
      organization: contact.organization || '',
      priority: contact.priority || 2,
      vipGroup: contact.vipGroup || '',
      notes: contact.notes || '',
      photoUrl: contact.photoUrl || ''
    });
    setIsDialogOpen(true);
  };

  const addSuggestionAsVip = (suggestion: any) => {
    setNewContact({
      email: suggestion.email,
      name: suggestion.name || '',
      organization: suggestion.organization || '',
      priority: 2,
      vipGroup: '',
      notes: '',
      photoUrl: ''
    });
    setIsDialogOpen(true);
  };

  const getPriorityColor = (priority: number | null) => {
    switch (priority) {
      case 1: return 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400';
      case 2: return 'bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-400';
      case 3: return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200';
    }
  };

  const getPriorityText = (priority: number | null) => {
    switch (priority) {
      case 1: return 'Normal';
      case 2: return 'High';
      case 3: return 'Critical';
      default: return 'Normal';
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  // Filter contacts based on search and group
  const filteredContacts = contacts.filter((contact: VipContact) => {
    const matchesSearch = !searchQuery || 
      contact.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      contact.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      contact.organization?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesGroup = selectedGroup === 'all' || contact.vipGroup === selectedGroup;
    
    return matchesSearch && matchesGroup;
  });

  // Get unique groups
  const groups = ['all', ...Array.from(new Set(contacts.map((c: VipContact) => c.vipGroup).filter(Boolean)))];

  // Group contacts by organization
  const contactsByOrg = filteredContacts.reduce((acc: any, contact: VipContact) => {
    const org = contact.organization || 'Other';
    if (!acc[org]) acc[org] = [];
    acc[org].push(contact);
    return acc;
  }, {});

  if (isLoading) {
    return <div>Loading VIP contacts...</div>;
  }

  return (
    <div className={`space-y-6 ${className}`} data-testid="vip-contact-manager">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">VIP Contacts</h2>
          <p className="text-muted-foreground">
            Manage your important contacts for priority email handling
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) {
            setEditingContact(null);
            resetForm();
          }
        }}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-vip">
              <Plus className="h-4 w-4 mr-2" />
              Add VIP Contact
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {editingContact ? 'Edit VIP Contact' : 'Add VIP Contact'}
              </DialogTitle>
              <DialogDescription>
                {editingContact 
                  ? 'Update the VIP contact information and priority settings'
                  : 'Add a new VIP contact to prioritize their emails'
                }
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="vip-email">Email Address *</Label>
                  <Input
                    id="vip-email"
                    type="email"
                    value={newContact.email}
                    onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
                    placeholder="contact@example.com"
                    data-testid="input-vip-email"
                  />
                </div>
                <div>
                  <Label htmlFor="vip-name">Full Name</Label>
                  <Input
                    id="vip-name"
                    value={newContact.name}
                    onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
                    placeholder="John Doe"
                    data-testid="input-vip-name"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="vip-organization">Organization</Label>
                  <Input
                    id="vip-organization"
                    value={newContact.organization}
                    onChange={(e) => setNewContact({ ...newContact, organization: e.target.value })}
                    placeholder="Acme Corporation"
                    data-testid="input-vip-organization"
                  />
                </div>
                <div>
                  <Label htmlFor="vip-group">Group</Label>
                  <Input
                    id="vip-group"
                    value={newContact.vipGroup || ''}
                    onChange={(e) => setNewContact({ ...newContact, vipGroup: e.target.value })}
                    placeholder="Executives, Clients, Family..."
                    data-testid="input-vip-group"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="vip-priority">Priority Level</Label>
                <Select
                  value={newContact.priority.toString()}
                  onValueChange={(value) => setNewContact({ ...newContact, priority: parseInt(value) })}
                >
                  <SelectTrigger data-testid="select-vip-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Normal Priority (1)</SelectItem>
                    <SelectItem value="2">High Priority (2)</SelectItem>
                    <SelectItem value="3">Critical Priority (3)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="vip-notes">Notes</Label>
                <Input
                  id="vip-notes"
                  value={newContact.notes}
                  onChange={(e) => setNewContact({ ...newContact, notes: e.target.value })}
                  placeholder="Additional notes about this contact..."
                  data-testid="input-vip-notes"
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    if (editingContact) {
                      updateVipMutation.mutate({ contactId: editingContact.id, updates: newContact });
                    } else {
                      createVipMutation.mutate(newContact);
                    }
                  }}
                  disabled={!newContact.email || createVipMutation.isPending || updateVipMutation.isPending}
                  data-testid="button-save-vip"
                >
                  {editingContact ? 'Update Contact' : 'Add Contact'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="contacts" className="space-y-4">
        <TabsList>
          <TabsTrigger value="contacts" data-testid="tab-contacts">Contacts</TabsTrigger>
          <TabsTrigger value="suggestions" data-testid="tab-suggestions">
            Suggestions 
            {suggestions.length > 0 && (
              <Badge variant="secondary" className="ml-2">{suggestions.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="contacts" className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search VIP contacts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                data-testid="input-search-vip"
              />
            </div>
            <Select value={selectedGroup} onValueChange={setSelectedGroup}>
              <SelectTrigger className="w-48" data-testid="select-group-filter">
                <SelectValue placeholder="Filter by group" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Groups</SelectItem>
                {groups.slice(1).filter((group): group is string => Boolean(group)).map((group) => (
                  <SelectItem key={group} value={group}>{group}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <ScrollArea className="h-[600px]">
            {filteredContacts.length === 0 ? (
              <Card className="p-8 text-center">
                <div className="mx-auto w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                  <Crown className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-medium mb-2">No VIP Contacts</h3>
                <p className="text-muted-foreground mb-4">
                  Add your first VIP contact to prioritize their emails
                </p>
                <Button onClick={() => setIsDialogOpen(true)} data-testid="button-add-first-vip">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Your First VIP Contact
                </Button>
              </Card>
            ) : (
              <div className="space-y-6">
                {Object.entries(contactsByOrg).map(([org, orgContacts]: [string, any]) => (
                  <div key={org}>
                    <div className="flex items-center gap-2 mb-3">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <h3 className="font-medium">{org}</h3>
                      <Badge variant="secondary">{orgContacts.length}</Badge>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {orgContacts.map((contact: VipContact) => (
                        <Card key={contact.id} className="p-4 hover-elevate">
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex items-center gap-3">
                              <Avatar className="h-10 w-10">
                                <AvatarImage src={contact.photoUrl || ''} />
                                <AvatarFallback>
                                  {getInitials(contact.name || contact.email)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium truncate">
                                  {contact.name || contact.email}
                                </p>
                                <p className="text-sm text-muted-foreground truncate">
                                  {contact.email}
                                </p>
                              </div>
                            </div>
                            <Crown className="h-4 w-4 text-amber-500" />
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <Badge className={getPriorityColor(contact.priority)}>
                                {getPriorityText(contact.priority)}
                              </Badge>
                              {contact.vipGroup && (
                                <Badge variant="outline">{contact.vipGroup}</Badge>
                              )}
                            </div>

                            {contact.interactionCount !== undefined && (
                              <p className="text-sm text-muted-foreground">
                                {contact.interactionCount} emails in last 30 days
                              </p>
                            )}

                            {contact.notes && (
                              <p className="text-sm text-muted-foreground truncate">
                                {contact.notes}
                              </p>
                            )}
                          </div>

                          <Separator className="my-3" />

                          <div className="flex justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEditDialog(contact)}
                              data-testid={`button-edit-${contact.id}`}
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteVipMutation.mutate(contact.id)}
                              data-testid={`button-delete-${contact.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="suggestions" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Star className="h-5 w-5" />
                Suggested VIP Contacts
              </CardTitle>
              <CardDescription>
                Based on your email interactions, these contacts might be good candidates for VIP status
              </CardDescription>
            </CardHeader>
            <CardContent>
              {suggestions.length === 0 ? (
                <div className="text-center py-8">
                  <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">
                    No suggestions available yet. Suggestions are based on your email interaction patterns.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {suggestions.map((suggestion: any, index: number) => (
                    <div key={index} className="flex items-center justify-between p-3 border rounded-md">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback>
                            {getInitials(suggestion.name || suggestion.email)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium">
                            {suggestion.name || suggestion.email}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {suggestion.email} • {suggestion.interactionCount} interactions
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => addSuggestionAsVip(suggestion)}
                        data-testid={`button-add-suggestion-${index}`}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add as VIP
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}