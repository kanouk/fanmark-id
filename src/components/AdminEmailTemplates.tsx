import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2, Save, RotateCcw } from "lucide-react";

interface EmailTemplate {
  id: string;
  email_type: string;
  language: string;
  subject: string;
  body_text: string;
  button_text: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const EMAIL_TYPES = [
  { value: "signup", label: "サインアップ確認" },
  { value: "recovery", label: "パスワードリセット" },
  { value: "magiclink", label: "マジックリンク" },
  { value: "email_change", label: "メールアドレス変更" },
];

const LANGUAGES = [
  { value: "ja", label: "日本語" },
  { value: "en", label: "English" },
  { value: "ko", label: "한국어" },
  { value: "id", label: "Indonesia" },
];

export const AdminEmailTemplates: React.FC = () => {
  const queryClient = useQueryClient();
  const [selectedType, setSelectedType] = useState("signup");
  const [editingTemplates, setEditingTemplates] = useState<Record<string, Partial<EmailTemplate>>>({});

  const { data: templates, isLoading } = useQuery({
    queryKey: ["email-templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_templates")
        .select("*")
        .order("email_type")
        .order("language");

      if (error) throw error;
      return data as EmailTemplate[];
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<EmailTemplate> }) => {
      const { error } = await supabase
        .from("email_templates")
        .update({
          subject: updates.subject,
          body_text: updates.body_text,
          button_text: updates.button_text,
        })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-templates"] });
      toast.success("テンプレートを保存しました");
    },
    onError: (error) => {
      console.error("Error updating template:", error);
      toast.error("保存に失敗しました");
    },
  });

  const getTemplate = (type: string, lang: string) => {
    return templates?.find((t) => t.email_type === type && t.language === lang);
  };

  const getEditingValue = (template: EmailTemplate | undefined, field: keyof EmailTemplate) => {
    if (!template) return "";
    const editKey = template.id;
    if (editingTemplates[editKey]?.[field] !== undefined) {
      return editingTemplates[editKey][field] as string;
    }
    return template[field] as string;
  };

  const handleChange = (templateId: string, field: keyof EmailTemplate, value: string) => {
    setEditingTemplates((prev) => ({
      ...prev,
      [templateId]: {
        ...prev[templateId],
        [field]: value,
      },
    }));
  };

  const handleSave = (template: EmailTemplate) => {
    const updates = editingTemplates[template.id];
    if (!updates) return;

    updateMutation.mutate({
      id: template.id,
      updates: {
        subject: updates.subject ?? template.subject,
        body_text: updates.body_text ?? template.body_text,
        button_text: updates.button_text ?? template.button_text,
      },
    });

    // Clear editing state for this template
    setEditingTemplates((prev) => {
      const newState = { ...prev };
      delete newState[template.id];
      return newState;
    });
  };

  const handleReset = (templateId: string) => {
    setEditingTemplates((prev) => {
      const newState = { ...prev };
      delete newState[templateId];
      return newState;
    });
  };

  const hasChanges = (templateId: string) => {
    return !!editingTemplates[templateId] && Object.keys(editingTemplates[templateId]).length > 0;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Tabs value={selectedType} onValueChange={setSelectedType}>
        <TabsList className="grid w-full grid-cols-4">
          {EMAIL_TYPES.map((type) => (
            <TabsTrigger key={type.value} value={type.value}>
              {type.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {EMAIL_TYPES.map((type) => (
          <TabsContent key={type.value} value={type.value} className="space-y-4 mt-6">
            <div className="grid gap-4 md:grid-cols-2">
              {LANGUAGES.map((lang) => {
                const template = getTemplate(type.value, lang.value);
                if (!template) return null;

                return (
                  <Card key={lang.value} className="border-border/60">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg flex items-center justify-between">
                        <span>{lang.label}</span>
                        {hasChanges(template.id) && (
                          <span className="text-xs font-normal text-amber-500">未保存の変更</span>
                        )}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor={`subject-${template.id}`}>件名</Label>
                        <Input
                          id={`subject-${template.id}`}
                          value={getEditingValue(template, "subject")}
                          onChange={(e) => handleChange(template.id, "subject", e.target.value)}
                          placeholder="件名を入力"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor={`body-${template.id}`}>本文</Label>
                        <Textarea
                          id={`body-${template.id}`}
                          value={getEditingValue(template, "body_text")}
                          onChange={(e) => handleChange(template.id, "body_text", e.target.value)}
                          placeholder="本文を入力"
                          rows={4}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor={`button-${template.id}`}>ボタンテキスト</Label>
                        <Input
                          id={`button-${template.id}`}
                          value={getEditingValue(template, "button_text")}
                          onChange={(e) => handleChange(template.id, "button_text", e.target.value)}
                          placeholder="ボタンテキストを入力"
                        />
                      </div>

                      <div className="flex gap-2 pt-2">
                        <Button
                          size="sm"
                          onClick={() => handleSave(template)}
                          disabled={!hasChanges(template.id) || updateMutation.isPending}
                        >
                          {updateMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          ) : (
                            <Save className="h-4 w-4 mr-2" />
                          )}
                          保存
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleReset(template.id)}
                          disabled={!hasChanges(template.id)}
                        >
                          <RotateCcw className="h-4 w-4 mr-2" />
                          リセット
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
};

export default AdminEmailTemplates;
