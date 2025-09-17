import { useState, useEffect } from 'react';
import { PenTool, Plus, Trash2, Edit3, Check, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface EmailSignature {
  id: string;
  name: string;
  content: string;
  isDefault?: boolean;
  isHtml?: boolean;
  createdAt: Date;
}

interface EmailSignaturesProps {
  onSignatureSelect: (signature: EmailSignature) => void;
  className?: string;
}

// Default signatures
const DEFAULT_SIGNATURES: EmailSignature[] = [
  {
    id: 'signature-1',
    name: 'Professional',
    content: `<div style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
  <p>Best regards,<br>
  <strong>[Your Name]</strong><br>
  [Your Title]<br>
  [Company Name]</p>
  
  <p style="color: #666; font-size: 12px;">
  📧 [your.email@company.com]<br>
  📱 [Your Phone Number]<br>
  🌐 [company-website.com]
  </p>
</div>`,
    isDefault: true,
    isHtml: true,
    createdAt: new Date('2024-01-01'),
  },
  {
    id: 'signature-2',
    name: 'Simple',
    content: `Best regards,
[Your Name]
[Your Title] | [Company Name]
[Email] | [Phone]`,
    isDefault: true,
    isHtml: false,
    createdAt: new Date('2024-01-01'),
  },
];

export function EmailSignatures({ onSignatureSelect, className }: EmailSignaturesProps) {
  const { toast } = useToast();
  const [signatures, setSignatures] = useState<EmailSignature[]>([]);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingSignature, setEditingSignature] = useState<EmailSignature | null>(null);
  const [previewMode, setPreviewMode] = useState<'edit' | 'preview'>('edit');

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    content: '',
    isDefault: false,
    isHtml: false,
  });

  // Load signatures from localStorage
  useEffect(() => {
    const savedSignatures = localStorage.getItem('email_signatures');
    if (savedSignatures) {
      try {
        const parsed = JSON.parse(savedSignatures);
        setSignatures([...DEFAULT_SIGNATURES, ...parsed]);
      } catch (error) {
        console.error('Failed to load signatures:', error);
        setSignatures(DEFAULT_SIGNATURES);
      }
    } else {
      setSignatures(DEFAULT_SIGNATURES);
    }
  }, []);

  // Save signatures to localStorage
  const saveSignatures = (signatureList: EmailSignature[]) => {
    const customSignatures = signatureList.filter(s => !s.isDefault);
    try {
      localStorage.setItem('email_signatures', JSON.stringify(customSignatures));
    } catch (error) {
      console.error('Failed to save signatures:', error);
      toast({
        description: "Failed to save signatures",
        variant: "destructive",
      });
    }
  };

  const handleCreateSignature = () => {
    if (!formData.name || !formData.content) {
      toast({
        description: "Please fill in all fields",
        variant: "destructive",
      });
      return;
    }

    const newSignature: EmailSignature = {
      id: `signature-${Date.now()}`,
      name: formData.name,
      content: formData.content,
      isDefault: formData.isDefault,
      isHtml: formData.isHtml,
      createdAt: new Date(),
    };

    let updatedSignatures = [...signatures, newSignature];

    // If this is set as default, remove default from others
    if (formData.isDefault) {
      updatedSignatures = updatedSignatures.map(s => ({ ...s, isDefault: s.id === newSignature.id }));
    }

    setSignatures(updatedSignatures);
    saveSignatures(updatedSignatures);

    // Reset form
    setFormData({
      name: '',
      content: '',
      isDefault: false,
      isHtml: false,
    });

    setIsCreateDialogOpen(false);
    toast({
      description: "Signature created successfully",
    });
  };

  const handleEditSignature = () => {
    if (!editingSignature || !formData.name || !formData.content) {
      return;
    }

    const updatedSignature = {
      ...editingSignature,
      name: formData.name,
      content: formData.content,
      isDefault: formData.isDefault,
      isHtml: formData.isHtml,
    };

    let updatedSignatures = signatures.map(s => 
      s.id === editingSignature.id ? updatedSignature : s
    );

    // If this is set as default, remove default from others
    if (formData.isDefault) {
      updatedSignatures = updatedSignatures.map(s => 
        ({ ...s, isDefault: s.id === editingSignature.id })
      );
    }

    setSignatures(updatedSignatures);
    saveSignatures(updatedSignatures);
    setEditingSignature(null);
    
    setFormData({
      name: '',
      content: '',
      isDefault: false,
      isHtml: false,
    });

    toast({
      description: "Signature updated successfully",
    });
  };

  const handleDeleteSignature = (signatureId: string) => {
    const signature = signatures.find(s => s.id === signatureId);
    if (signature?.isDefault && signatures.filter(s => s.isDefault).length === 1) {
      toast({
        description: "Cannot delete the only default signature",
        variant: "destructive",
      });
      return;
    }

    const updatedSignatures = signatures.filter(s => s.id !== signatureId);
    setSignatures(updatedSignatures);
    saveSignatures(updatedSignatures);

    toast({
      description: "Signature deleted successfully",
    });
  };

  const handleSetDefault = (signatureId: string) => {
    const updatedSignatures = signatures.map(s => 
      ({ ...s, isDefault: s.id === signatureId })
    );
    setSignatures(updatedSignatures);
    saveSignatures(updatedSignatures);

    toast({
      description: "Default signature updated",
    });
  };

  const handleUseSignature = (signature: EmailSignature) => {
    onSignatureSelect(signature);
    toast({
      description: `"${signature.name}" signature inserted`,
    });
  };

  const startEditingSignature = (signature: EmailSignature) => {
    setEditingSignature(signature);
    setFormData({
      name: signature.name,
      content: signature.content,
      isDefault: signature.isDefault || false,
      isHtml: signature.isHtml || false,
    });
    setPreviewMode('edit');
  };

  const renderSignaturePreview = (signature: EmailSignature) => {
    if (signature.isHtml) {
      return (
        <div 
          className="text-sm border rounded p-2 bg-muted/20"
          dangerouslySetInnerHTML={{ __html: signature.content }}
        />
      );
    } else {
      return (
        <div className="text-sm border rounded p-2 bg-muted/20 whitespace-pre-wrap font-mono">
          {signature.content}
        </div>
      );
    }
  };

  const defaultSignature = signatures.find(s => s.isDefault);

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Email Signatures</CardTitle>
          <Dialog 
            open={isCreateDialogOpen} 
            onOpenChange={(open) => {
              setIsCreateDialogOpen(open);
              if (!open) {
                setFormData({
                  name: '',
                  content: '',
                  isDefault: false,
                  isHtml: false,
                });
                setPreviewMode('edit');
              }
            }}
          >
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-create-signature">
                <Plus className="h-4 w-4 mr-1" />
                New Signature
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>
                  {editingSignature ? 'Edit Signature' : 'Create Email Signature'}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="signature-name">Signature Name</Label>
                  <Input
                    id="signature-name"
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g., Professional, Casual, etc."
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className="flex items-center space-x-2">
                      <Switch
                        id="is-default"
                        checked={formData.isDefault}
                        onCheckedChange={(checked) => setFormData(prev => ({ ...prev, isDefault: checked }))}
                      />
                      <Label htmlFor="is-default" className="text-sm">Set as default</Label>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Switch
                        id="is-html"
                        checked={formData.isHtml}
                        onCheckedChange={(checked) => setFormData(prev => ({ ...prev, isHtml: checked }))}
                      />
                      <Label htmlFor="is-html" className="text-sm">HTML format</Label>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setPreviewMode(previewMode === 'edit' ? 'preview' : 'edit')}
                      className="text-xs"
                    >
                      <Eye className="h-3 w-3 mr-1" />
                      {previewMode === 'edit' ? 'Preview' : 'Edit'}
                    </Button>
                  </div>
                </div>

                {previewMode === 'edit' ? (
                  <div>
                    <Label htmlFor="signature-content">Signature Content</Label>
                    <Textarea
                      id="signature-content"
                      value={formData.content}
                      onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
                      placeholder={formData.isHtml 
                        ? "Enter HTML content for your signature..." 
                        : "Enter plain text content for your signature..."
                      }
                      className="min-h-40 font-mono text-sm"
                    />
                    <div className="text-xs text-muted-foreground mt-1">
                      Use placeholders like [Your Name], [Company], [Email], etc. These can be replaced when sending.
                    </div>
                  </div>
                ) : (
                  <div>
                    <Label>Preview</Label>
                    <div className="min-h-40 border rounded-md p-3 bg-background">
                      {formData.content ? (
                        formData.isHtml ? (
                          <div dangerouslySetInnerHTML={{ __html: formData.content }} />
                        ) : (
                          <div className="whitespace-pre-wrap">{formData.content}</div>
                        )
                      ) : (
                        <div className="text-muted-foreground">Signature preview will appear here...</div>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsCreateDialogOpen(false);
                      setEditingSignature(null);
                      setFormData({
                        name: '',
                        content: '',
                        isDefault: false,
                        isHtml: false,
                      });
                      setPreviewMode('edit');
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={editingSignature ? handleEditSignature : handleCreateSignature}
                  >
                    {editingSignature ? 'Update Signature' : 'Create Signature'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      
      <CardContent>
        {defaultSignature && (
          <div className="mb-4 p-3 border rounded-lg bg-accent/20">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <h4 className="font-medium">Default: {defaultSignature.name}</h4>
                <Check className="h-4 w-4 text-green-600" />
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleUseSignature(defaultSignature)}
                className="text-xs h-6 px-2"
              >
                Insert
              </Button>
            </div>
            {renderSignaturePreview(defaultSignature)}
          </div>
        )}

        <ScrollArea className="h-60">
          <div className="space-y-2">
            {signatures.filter(s => !s.isDefault).map((signature) => (
              <div
                key={signature.id}
                className="flex items-start justify-between p-3 border rounded-lg hover-elevate transition-colors group"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <h4 className="font-medium">{signature.name}</h4>
                    {signature.isHtml && (
                      <span className="text-xs bg-blue-100 text-blue-800 px-1 rounded">HTML</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mb-2">
                    Created {signature.createdAt.toLocaleDateString()}
                  </div>
                  {renderSignaturePreview(signature)}
                </div>
                
                <div className="flex items-center gap-1 ml-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleUseSignature(signature)}
                    data-testid={`button-use-signature-${signature.id}`}
                    className="h-6 px-2 text-xs"
                  >
                    Insert
                  </Button>
                  
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSetDefault(signature.id)}
                    className="h-6 px-2 text-xs"
                  >
                    Set Default
                  </Button>
                  
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => startEditingSignature(signature)}
                    className="h-6 px-2"
                  >
                    <Edit3 className="h-3 w-3" />
                  </Button>
                  
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteSignature(signature.id)}
                    className="h-6 px-2 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
            
            {signatures.filter(s => !s.isDefault).length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <PenTool className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No additional signatures</p>
                <p className="text-sm">Create custom signatures for different purposes</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>

      {/* Edit Dialog */}
      <Dialog 
        open={!!editingSignature} 
        onOpenChange={(open) => {
          if (!open) {
            setEditingSignature(null);
            setFormData({
              name: '',
              content: '',
              isDefault: false,
              isHtml: false,
            });
            setPreviewMode('edit');
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Signature</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="edit-signature-name">Signature Name</Label>
              <Input
                id="edit-signature-name"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g., Professional, Casual, etc."
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="edit-is-default"
                    checked={formData.isDefault}
                    onCheckedChange={(checked) => setFormData(prev => ({ ...prev, isDefault: checked }))}
                  />
                  <Label htmlFor="edit-is-default" className="text-sm">Set as default</Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Switch
                    id="edit-is-html"
                    checked={formData.isHtml}
                    onCheckedChange={(checked) => setFormData(prev => ({ ...prev, isHtml: checked }))}
                  />
                  <Label htmlFor="edit-is-html" className="text-sm">HTML format</Label>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPreviewMode(previewMode === 'edit' ? 'preview' : 'edit')}
                  className="text-xs"
                >
                  <Eye className="h-3 w-3 mr-1" />
                  {previewMode === 'edit' ? 'Preview' : 'Edit'}
                </Button>
              </div>
            </div>

            {previewMode === 'edit' ? (
              <div>
                <Label htmlFor="edit-signature-content">Signature Content</Label>
                <Textarea
                  id="edit-signature-content"
                  value={formData.content}
                  onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
                  placeholder={formData.isHtml 
                    ? "Enter HTML content for your signature..." 
                    : "Enter plain text content for your signature..."
                  }
                  className="min-h-40 font-mono text-sm"
                />
                <div className="text-xs text-muted-foreground mt-1">
                  Use placeholders like [Your Name], [Company], [Email], etc.
                </div>
              </div>
            ) : (
              <div>
                <Label>Preview</Label>
                <div className="min-h-40 border rounded-md p-3 bg-background">
                  {formData.content ? (
                    formData.isHtml ? (
                      <div dangerouslySetInnerHTML={{ __html: formData.content }} />
                    ) : (
                      <div className="whitespace-pre-wrap">{formData.content}</div>
                    )
                  ) : (
                    <div className="text-muted-foreground">Signature preview will appear here...</div>
                  )}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setEditingSignature(null);
                  setFormData({
                    name: '',
                    content: '',
                    isDefault: false,
                    isHtml: false,
                  });
                  setPreviewMode('edit');
                }}
              >
                Cancel
              </Button>
              <Button onClick={handleEditSignature}>
                Update Signature
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}