import { useState, useEffect } from 'react';
import { FileText, Plus, Trash2, Edit3, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  category: 'business' | 'personal' | 'support' | 'marketing' | 'follow-up';
  isDefault?: boolean;
  createdAt: Date;
  lastUsed?: Date;
}

interface EmailTemplatesProps {
  onTemplateSelect: (template: EmailTemplate) => void;
  className?: string;
}

// Default email templates
const DEFAULT_TEMPLATES: EmailTemplate[] = [
  {
    id: 'template-1',
    name: 'Meeting Request',
    subject: 'Meeting Request - [Meeting Topic]',
    body: `<p>Hi [Name],</p>

<p>I hope this email finds you well. I would like to schedule a meeting to discuss [meeting topic/purpose].</p>

<p><strong>Proposed Details:</strong></p>
<ul>
  <li><strong>Date:</strong> [Date]</li>
  <li><strong>Time:</strong> [Time]</li>
  <li><strong>Duration:</strong> [Duration]</li>
  <li><strong>Location/Platform:</strong> [Location or video call link]</li>
</ul>

<p><strong>Agenda:</strong></p>
<ul>
  <li>[Agenda item 1]</li>
  <li>[Agenda item 2]</li>
  <li>[Agenda item 3]</li>
</ul>

<p>Please let me know if this time works for you, or suggest alternative times that better fit your schedule.</p>

<p>Looking forward to our discussion.</p>

<p>Best regards,<br>[Your Name]</p>`,
    category: 'business',
    isDefault: true,
    createdAt: new Date('2024-01-01'),
  },
  {
    id: 'template-2',
    name: 'Follow-up Email',
    subject: 'Following up on our conversation',
    body: `<p>Hi [Name],</p>

<p>I wanted to follow up on our conversation from [date/context] regarding [topic].</p>

<p>As discussed, here are the next steps:</p>
<ul>
  <li>[Action item 1]</li>
  <li>[Action item 2]</li>
  <li>[Action item 3]</li>
</ul>

<p>I've attached [relevant documents/information] for your review.</p>

<p>Please don't hesitate to reach out if you have any questions or need clarification on any of the points discussed.</p>

<p>Thank you for your time, and I look forward to hearing from you soon.</p>

<p>Best regards,<br>[Your Name]</p>`,
    category: 'follow-up',
    isDefault: true,
    createdAt: new Date('2024-01-01'),
  },
  {
    id: 'template-3',
    name: 'Thank You Email',
    subject: 'Thank you for [context]',
    body: `<p>Dear [Name],</p>

<p>I wanted to take a moment to express my sincere gratitude for [specific reason/context].</p>

<p>Your [help/support/time/expertise] has been invaluable, and I truly appreciate [specific details about what they did].</p>

<p>Thanks to your assistance, [positive outcome or result achieved].</p>

<p>I look forward to [future collaboration/maintaining our relationship/returning the favor].</p>

<p>Once again, thank you for everything.</p>

<p>Warm regards,<br>[Your Name]</p>`,
    category: 'personal',
    isDefault: true,
    createdAt: new Date('2024-01-01'),
  },
  {
    id: 'template-4',
    name: 'Customer Support Response',
    subject: 'Re: Your Support Request [Ticket #]',
    body: `<p>Dear [Customer Name],</p>

<p>Thank you for contacting our support team. We have received your inquiry regarding [issue description] and appreciate you bringing this to our attention.</p>

<p><strong>Issue Summary:</strong> [Brief description of the problem]</p>

<p><strong>Resolution:</strong></p>
<p>[Detailed explanation of the solution or steps being taken]</p>

<p><strong>Next Steps:</strong></p>
<ul>
  <li>[Step 1]</li>
  <li>[Step 2]</li>
  <li>[Step 3]</li>
</ul>

<p>This issue should be resolved within [timeframe]. We will keep you updated on our progress.</p>

<p>If you have any additional questions or concerns, please don't hesitate to reply to this email or contact us at [contact information].</p>

<p>Thank you for your patience and for being a valued customer.</p>

<p>Best regards,<br>[Your Name]<br>[Company Name] Support Team</p>`,
    category: 'support',
    isDefault: true,
    createdAt: new Date('2024-01-01'),
  },
];

export function EmailTemplates({ onTemplateSelect, className }: EmailTemplatesProps) {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Form state for creating/editing templates
  const [formData, setFormData] = useState({
    name: '',
    subject: '',
    body: '',
    category: 'business' as EmailTemplate['category'],
  });

  // Load templates from localStorage on mount
  useEffect(() => {
    const savedTemplates = localStorage.getItem('email_templates');
    if (savedTemplates) {
      try {
        const parsed = JSON.parse(savedTemplates);
        setTemplates([...DEFAULT_TEMPLATES, ...parsed]);
      } catch (error) {
        console.error('Failed to load templates:', error);
        setTemplates(DEFAULT_TEMPLATES);
      }
    } else {
      setTemplates(DEFAULT_TEMPLATES);
    }
  }, []);

  // Save templates to localStorage
  const saveTemplates = (templateList: EmailTemplate[]) => {
    const customTemplates = templateList.filter(t => !t.isDefault);
    try {
      localStorage.setItem('email_templates', JSON.stringify(customTemplates));
    } catch (error) {
      console.error('Failed to save templates:', error);
      toast({
        description: "Failed to save templates",
        variant: "destructive",
      });
    }
  };

  const handleCreateTemplate = () => {
    if (!formData.name || !formData.subject || !formData.body) {
      toast({
        description: "Please fill in all fields",
        variant: "destructive",
      });
      return;
    }

    const newTemplate: EmailTemplate = {
      id: `template-${Date.now()}`,
      name: formData.name,
      subject: formData.subject,
      body: formData.body,
      category: formData.category,
      createdAt: new Date(),
    };

    const updatedTemplates = [...templates, newTemplate];
    setTemplates(updatedTemplates);
    saveTemplates(updatedTemplates);

    // Reset form
    setFormData({
      name: '',
      subject: '',
      body: '',
      category: 'business',
    });

    setIsCreateDialogOpen(false);
    toast({
      description: "Template created successfully",
    });
  };

  const handleEditTemplate = () => {
    if (!editingTemplate || !formData.name || !formData.subject || !formData.body) {
      return;
    }

    const updatedTemplate = {
      ...editingTemplate,
      name: formData.name,
      subject: formData.subject,
      body: formData.body,
      category: formData.category,
    };

    const updatedTemplates = templates.map(t => 
      t.id === editingTemplate.id ? updatedTemplate : t
    );

    setTemplates(updatedTemplates);
    saveTemplates(updatedTemplates);
    setEditingTemplate(null);
    
    setFormData({
      name: '',
      subject: '',
      body: '',
      category: 'business',
    });

    toast({
      description: "Template updated successfully",
    });
  };

  const handleDeleteTemplate = (templateId: string) => {
    const template = templates.find(t => t.id === templateId);
    if (template?.isDefault) {
      toast({
        description: "Cannot delete default templates",
        variant: "destructive",
      });
      return;
    }

    const updatedTemplates = templates.filter(t => t.id !== templateId);
    setTemplates(updatedTemplates);
    saveTemplates(updatedTemplates);

    toast({
      description: "Template deleted successfully",
    });
  };

  const handleUseTemplate = (template: EmailTemplate) => {
    // Update last used timestamp
    const updatedTemplate = { ...template, lastUsed: new Date() };
    const updatedTemplates = templates.map(t => 
      t.id === template.id ? updatedTemplate : t
    );
    setTemplates(updatedTemplates);
    saveTemplates(updatedTemplates);

    onTemplateSelect(updatedTemplate);
    
    toast({
      description: `"${template.name}" template applied`,
    });
  };

  const startEditingTemplate = (template: EmailTemplate) => {
    if (template.isDefault) {
      toast({
        description: "Cannot edit default templates. Create a copy instead.",
        variant: "destructive",
      });
      return;
    }

    setEditingTemplate(template);
    setFormData({
      name: template.name,
      subject: template.subject,
      body: template.body,
      category: template.category,
    });
  };

  const categoryColors = {
    business: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
    personal: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
    support: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300',
    marketing: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
    'follow-up': 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300',
  };

  const filteredTemplates = selectedCategory === 'all' 
    ? templates 
    : templates.filter(t => t.category === selectedCategory);

  const categories = ['all', 'business', 'personal', 'support', 'marketing', 'follow-up'];

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Email Templates</CardTitle>
          <Dialog 
            open={isCreateDialogOpen} 
            onOpenChange={(open) => {
              setIsCreateDialogOpen(open);
              if (!open) {
                setFormData({
                  name: '',
                  subject: '',
                  body: '',
                  category: 'business',
                });
              }
            }}
          >
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-create-template">
                <Plus className="h-4 w-4 mr-1" />
                New Template
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>
                  {editingTemplate ? 'Edit Template' : 'Create Email Template'}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="template-name">Template Name</Label>
                  <Input
                    id="template-name"
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g., Meeting Request"
                  />
                </div>
                
                <div>
                  <Label htmlFor="template-category">Category</Label>
                  <select
                    id="template-category"
                    value={formData.category}
                    onChange={(e) => setFormData(prev => ({ 
                      ...prev, 
                      category: e.target.value as EmailTemplate['category'] 
                    }))}
                    className="w-full px-3 py-2 border border-border rounded-md bg-background"
                  >
                    <option value="business">Business</option>
                    <option value="personal">Personal</option>
                    <option value="support">Support</option>
                    <option value="marketing">Marketing</option>
                    <option value="follow-up">Follow-up</option>
                  </select>
                </div>

                <div>
                  <Label htmlFor="template-subject">Subject Line</Label>
                  <Input
                    id="template-subject"
                    value={formData.subject}
                    onChange={(e) => setFormData(prev => ({ ...prev, subject: e.target.value }))}
                    placeholder="e.g., Meeting Request - [Meeting Topic]"
                  />
                </div>

                <div>
                  <Label htmlFor="template-body">Email Body</Label>
                  <Textarea
                    id="template-body"
                    value={formData.body}
                    onChange={(e) => setFormData(prev => ({ ...prev, body: e.target.value }))}
                    placeholder="Write your template content here. Use [Name], [Date], etc. for placeholders."
                    className="min-h-40"
                  />
                </div>

                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsCreateDialogOpen(false);
                      setEditingTemplate(null);
                      setFormData({
                        name: '',
                        subject: '',
                        body: '',
                        category: 'business',
                      });
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={editingTemplate ? handleEditTemplate : handleCreateTemplate}
                  >
                    {editingTemplate ? 'Update Template' : 'Create Template'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
        
        {/* Category filters */}
        <div className="flex flex-wrap gap-1 mt-2">
          {categories.map((category) => (
            <Button
              key={category}
              variant={selectedCategory === category ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedCategory(category)}
              className="text-xs h-6"
            >
              {category === 'all' ? 'All' : category.charAt(0).toUpperCase() + category.slice(1)}
            </Button>
          ))}
        </div>
      </CardHeader>
      
      <CardContent>
        <ScrollArea className="h-80">
          <div className="space-y-2">
            {filteredTemplates.map((template) => (
              <div
                key={template.id}
                className="flex items-start justify-between p-3 border rounded-lg hover-elevate transition-colors group"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-medium truncate">{template.name}</h4>
                    <Badge className={cn("text-xs", categoryColors[template.category])}>
                      {template.category}
                    </Badge>
                    {template.isDefault && (
                      <Badge variant="outline" className="text-xs">
                        Default
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground truncate mb-1">
                    {template.subject}
                  </p>
                  <div className="text-xs text-muted-foreground">
                    Created {template.createdAt.toLocaleDateString()}
                    {template.lastUsed && (
                      <> • Last used {template.lastUsed.toLocaleDateString()}</>
                    )}
                  </div>
                </div>
                
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleUseTemplate(template)}
                    data-testid={`button-use-template-${template.id}`}
                    className="h-6 px-2 text-xs"
                  >
                    <Copy className="h-3 w-3 mr-1" />
                    Use
                  </Button>
                  
                  {!template.isDefault && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => startEditingTemplate(template)}
                        className="h-6 px-2"
                      >
                        <Edit3 className="h-3 w-3" />
                      </Button>
                      
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteTemplate(template.id)}
                        className="h-6 px-2 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
            
            {filteredTemplates.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No templates found</p>
                <p className="text-sm">Create your first template to get started</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>

      {/* Edit Dialog */}
      <Dialog 
        open={!!editingTemplate} 
        onOpenChange={(open) => {
          if (!open) {
            setEditingTemplate(null);
            setFormData({
              name: '',
              subject: '',
              body: '',
              category: 'business',
            });
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Template</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="edit-template-name">Template Name</Label>
              <Input
                id="edit-template-name"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g., Meeting Request"
              />
            </div>
            
            <div>
              <Label htmlFor="edit-template-category">Category</Label>
              <select
                id="edit-template-category"
                value={formData.category}
                onChange={(e) => setFormData(prev => ({ 
                  ...prev, 
                  category: e.target.value as EmailTemplate['category'] 
                }))}
                className="w-full px-3 py-2 border border-border rounded-md bg-background"
              >
                <option value="business">Business</option>
                <option value="personal">Personal</option>
                <option value="support">Support</option>
                <option value="marketing">Marketing</option>
                <option value="follow-up">Follow-up</option>
              </select>
            </div>

            <div>
              <Label htmlFor="edit-template-subject">Subject Line</Label>
              <Input
                id="edit-template-subject"
                value={formData.subject}
                onChange={(e) => setFormData(prev => ({ ...prev, subject: e.target.value }))}
                placeholder="e.g., Meeting Request - [Meeting Topic]"
              />
            </div>

            <div>
              <Label htmlFor="edit-template-body">Email Body</Label>
              <Textarea
                id="edit-template-body"
                value={formData.body}
                onChange={(e) => setFormData(prev => ({ ...prev, body: e.target.value }))}
                placeholder="Write your template content here. Use [Name], [Date], etc. for placeholders."
                className="min-h-40"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setEditingTemplate(null);
                  setFormData({
                    name: '',
                    subject: '',
                    body: '',
                    category: 'business',
                  });
                }}
              >
                Cancel
              </Button>
              <Button onClick={handleEditTemplate}>
                Update Template
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}