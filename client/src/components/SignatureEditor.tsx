import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bold, Italic, Underline, Type, Palette, Save, X, Eye, Code, Star, User, Mail, Calendar, Building } from "lucide-react";
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import type { Signature, CreateSignatureRequest, AccountConnection, SignatureTemplate } from "@shared/schema";
import { baseCreateSignatureRequestSchema, createSignatureRequestSchema } from "@shared/schema";
import { z } from "zod";

interface SignatureEditorProps {
  signature?: Signature;
  accounts: AccountConnection[];
  onSave: (signatureData: CreateSignatureRequest) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

// Signature templates for quick setup
const signatureTemplates: SignatureTemplate[] = [
  {
    id: "business-professional",
    name: "Business Professional",
    description: "Clean and professional signature for business communications",
    category: "business",
    contentHtml: `<div style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
      <div style="font-weight: bold; color: #2563eb;">{{name}}</div>
      <div style="color: #666; margin: 2px 0;">{{title}}</div>
      <div style="color: #666; margin: 2px 0;">{{company}}</div>
      <div style="margin: 8px 0; padding-top: 8px; border-top: 1px solid #e5e7eb;">
        <div style="color: #666;">📧 {{email}}</div>
        <div style="color: #666;">📱 {{phone}}</div>
        <div style="color: #666;">🌐 {{website}}</div>
      </div>
    </div>`,
    contentText: `{{name}}\n{{title}}\n{{company}}\n\n📧 {{email}}\n📱 {{phone}}\n🌐 {{website}}`,
    variables: ["name", "email", "title", "company", "phone", "website"]
  },
  {
    id: "casual-friendly",
    name: "Casual & Friendly",
    description: "Warm and approachable signature for informal communications",
    category: "casual",
    contentHtml: `<div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; font-size: 14px; color: #374151;">
      <div style="font-weight: 600; color: #1f2937;">Best regards,</div>
      <div style="font-weight: 600; color: #059669; margin: 4px 0;">{{name}}</div>
      <div style="color: #6b7280; margin: 2px 0;">{{email}}</div>
      <div style="margin-top: 8px; color: #9ca3af; font-style: italic;">"{{quote}}"</div>
    </div>`,
    contentText: `Best regards,\n{{name}}\n{{email}}\n\n"{{quote}}"`,
    variables: ["name", "email", "quote"]
  },
  {
    id: "minimal-modern",
    name: "Minimal Modern",
    description: "Clean and minimal signature with modern styling",
    category: "personal",
    contentHtml: `<div style="font-family: system-ui, -apple-system, sans-serif; font-size: 14px; line-height: 1.5;">
      <div style="font-weight: 500; color: #111827;">{{name}}</div>
      <div style="color: #6b7280; font-size: 13px;">{{email}} • {{phone}}</div>
      <div style="margin-top: 8px; height: 2px; width: 40px; background: linear-gradient(90deg, #3b82f6, #10b981);"></div>
    </div>`,
    contentText: `{{name}}\n{{email}} • {{phone}}`,
    variables: ["name", "email", "phone"]
  }
];

// Form schema extending the base create signature schema for UI-specific validation
const signatureFormSchema = baseCreateSignatureRequestSchema.extend({
  template: z.string().optional(),
  variables: z.record(z.string()).optional()
}).refine(
  (data) => data.contentHtml || data.contentText,
  {
    message: "Signature must have either HTML or text content",
    path: ["contentHtml"]
  }
);

type SignatureFormData = z.infer<typeof signatureFormSchema>;

export function SignatureEditor({ signature, accounts, onSave, onCancel, isLoading = false }: SignatureEditorProps) {
  const [activeTab, setActiveTab] = useState<"editor" | "templates" | "preview">("editor");
  const [selectedTemplate, setSelectedTemplate] = useState<SignatureTemplate | null>(null);
  const [variables, setVariables] = useState<Record<string, string>>({
    name: "",
    email: "",
    title: "",
    company: "",
    phone: "",
    website: "",
    quote: "Success is where preparation and opportunity meet."
  });

  // TipTap editor for rich text editing
  const editor = useEditor({
    extensions: [StarterKit],
    content: signature?.contentHtml || "",
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none focus:outline-none min-h-[200px] p-4 border rounded-md",
      },
    },
  });

  // Form setup
  const form = useForm<SignatureFormData>({
    resolver: zodResolver(signatureFormSchema),
    defaultValues: {
      name: signature?.name || "",
      contentHtml: signature?.contentHtml || "",
      contentText: signature?.contentText || "",
      accountId: signature?.accountId || undefined,
      isDefault: signature?.isDefault || false,
      isActive: signature?.isActive ?? true,
      sortOrder: signature?.sortOrder || 0,
      templateType: signature?.templateType || undefined
    }
  });

  // Update editor content when signature changes
  useEffect(() => {
    if (editor && signature?.contentHtml) {
      editor.commands.setContent(signature.contentHtml);
    }
  }, [editor, signature]);

  // Update form when editor content changes
  useEffect(() => {
    if (editor) {
      const handleUpdate = () => {
        const html = editor.getHTML();
        const text = editor.getText();
        form.setValue("contentHtml", html);
        form.setValue("contentText", text);
      };

      editor.on('update', handleUpdate);
      return () => {
        editor.off('update', handleUpdate);
      };
    }
  }, [editor, form]);

  // Apply template to editor
  const applyTemplate = (template: SignatureTemplate) => {
    if (!editor) return;

    // Replace variables in template content
    let html = template.contentHtml;
    let text = template.contentText;

    Object.entries(variables).forEach(([key, value]) => {
      const placeholder = `{{${key}}}`;
      html = html.replace(new RegExp(placeholder, 'g'), value || placeholder);
      text = text.replace(new RegExp(placeholder, 'g'), value || placeholder);
    });

    editor.commands.setContent(html);
    form.setValue("contentHtml", html);
    form.setValue("contentText", text);
    form.setValue("templateType", template.id);
    setSelectedTemplate(template);
    setActiveTab("editor");
  };

  // Generate preview content with variables replaced
  const generatePreview = () => {
    const html = form.watch("contentHtml") || "";
    let preview = html;

    Object.entries(variables).forEach(([key, value]) => {
      const placeholder = `{{${key}}}`;
      preview = preview.replace(new RegExp(placeholder, 'g'), value || placeholder);
    });

    return preview;
  };

  // Form submission
  const handleSubmit = async (data: SignatureFormData) => {
    const { template, variables: formVariables, ...signatureData } = data;
    await onSave(signatureData);
  };

  if (!editor) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Loading Signature Editor...</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-4xl">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              {signature ? "Edit Signature" : "Create New Signature"}
            </CardTitle>
            <CardDescription>
              {signature ? "Update your email signature" : "Create a professional email signature with rich text formatting"}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onCancel}
              data-testid="button-cancel-signature"
            >
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
            <Button
              onClick={form.handleSubmit(handleSubmit)}
              disabled={isLoading}
              size="sm"
              data-testid="button-save-signature"
            >
              <Save className="h-4 w-4 mr-2" />
              {isLoading ? "Saving..." : "Save Signature"}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        <Form {...form}>
          <form className="space-y-6">
            {/* Basic Settings */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Signature Name</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="e.g., Business Professional"
                        data-testid="input-signature-name"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="accountId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Associated Account (Optional)</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value || ""}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-signature-account">
                          <SelectValue placeholder="All accounts" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="">All accounts</SelectItem>
                        {accounts.map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Settings toggles */}
            <div className="flex items-center gap-6">
              <FormField
                control={form.control}
                name="isDefault"
                render={({ field }) => (
                  <FormItem className="flex items-center space-x-2 space-y-0">
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="switch-signature-default"
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel className="flex items-center gap-2">
                        <Star className="h-4 w-4" />
                        Set as Default
                      </FormLabel>
                    </div>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <FormItem className="flex items-center space-x-2 space-y-0">
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="switch-signature-active"
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel>Active</FormLabel>
                    </div>
                  </FormItem>
                )}
              />
            </div>

            <Separator />

            {/* Editor Tabs */}
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as typeof activeTab)}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="editor" data-testid="tab-signature-editor">
                  <Type className="h-4 w-4 mr-2" />
                  Editor
                </TabsTrigger>
                <TabsTrigger value="templates" data-testid="tab-signature-templates">
                  <Building className="h-4 w-4 mr-2" />
                  Templates
                </TabsTrigger>
                <TabsTrigger value="preview" data-testid="tab-signature-preview">
                  <Eye className="h-4 w-4 mr-2" />
                  Preview
                </TabsTrigger>
              </TabsList>

              <TabsContent value="editor" className="space-y-4">
                {/* Formatting Toolbar */}
                <div className="flex items-center gap-2 p-2 border rounded-md bg-muted/50">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => editor.chain().focus().toggleBold().run()}
                    className={editor.isActive('bold') ? 'bg-accent' : ''}
                    data-testid="button-format-bold"
                  >
                    <Bold className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => editor.chain().focus().toggleItalic().run()}
                    className={editor.isActive('italic') ? 'bg-accent' : ''}
                    data-testid="button-format-italic"
                  >
                    <Italic className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => editor.chain().focus().toggleStrike().run()}
                    className={editor.isActive('strike') ? 'bg-accent' : ''}
                    data-testid="button-format-underline"
                  >
                    <Underline className="h-4 w-4" />
                  </Button>
                  <Separator orientation="vertical" className="h-6" />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => editor.chain().focus().setParagraph().run()}
                    className={editor.isActive('paragraph') ? 'bg-accent' : ''}
                    data-testid="button-format-paragraph"
                  >
                    Paragraph
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => editor.chain().focus().toggleBulletList().run()}
                    className={editor.isActive('bulletList') ? 'bg-accent' : ''}
                    data-testid="button-format-list"
                  >
                    List
                  </Button>
                </div>

                {/* Rich Text Editor */}
                <div className="border rounded-md min-h-[250px]">
                  <EditorContent 
                    editor={editor} 
                    data-testid="editor-signature-content"
                  />
                </div>

                {/* Variables Helper */}
                {selectedTemplate && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Template Variables</CardTitle>
                      <CardDescription>
                        Customize the variables for your template
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {selectedTemplate.variables.map((variable) => (
                          <div key={variable}>
                            <Label htmlFor={`var-${variable}`} className="capitalize">
                              {variable}
                            </Label>
                            <Input
                              id={`var-${variable}`}
                              value={variables[variable] || ""}
                              onChange={(e) => setVariables(prev => ({
                                ...prev,
                                [variable]: e.target.value
                              }))}
                              placeholder={`Enter ${variable}`}
                              data-testid={`input-variable-${variable}`}
                            />
                          </div>
                        ))}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => applyTemplate(selectedTemplate)}
                        className="mt-4"
                        data-testid="button-apply-variables"
                      >
                        Apply Variables
                      </Button>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="templates" className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {signatureTemplates.map((template) => (
                    <Card 
                      key={template.id} 
                      className={`cursor-pointer transition-all hover-elevate ${
                        selectedTemplate?.id === template.id ? 'ring-2 ring-primary' : ''
                      }`}
                      onClick={() => setSelectedTemplate(template)}
                      data-testid={`template-${template.id}`}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm">{template.name}</CardTitle>
                          <Badge variant="secondary">{template.category}</Badge>
                        </div>
                        <CardDescription className="text-xs">
                          {template.description}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div 
                          className="text-xs border rounded p-2 bg-muted/50 min-h-[100px] overflow-hidden"
                          dangerouslySetInnerHTML={{ __html: template.contentHtml }}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            applyTemplate(template);
                          }}
                          className="w-full mt-3"
                          data-testid={`button-use-template-${template.id}`}
                        >
                          Use Template
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="preview" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Eye className="h-4 w-4" />
                      Signature Preview
                    </CardTitle>
                    <CardDescription>
                      This is how your signature will appear in emails
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="border rounded-md p-4 bg-background min-h-[200px]">
                      <div 
                        className="prose prose-sm max-w-none"
                        dangerouslySetInnerHTML={{ __html: generatePreview() }}
                        data-testid="preview-signature-content"
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* HTML Source */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Code className="h-4 w-4" />
                      HTML Source
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-[200px]">
                      <code data-testid="preview-signature-html">
                        {generatePreview()}
                      </code>
                    </pre>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}