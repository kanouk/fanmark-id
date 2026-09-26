import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { createAdminEmailTemplatesApi, getAdminEmailTemplatesBackend } from "@/lib/admin-email-templates-api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  const backend = getAdminEmailTemplatesBackend();
  const workerApi = createAdminEmailTemplatesApi();
  const [selectedType, setSelectedType] = useState("signup");
  const [editingTemplates, setEditingTemplates] = useState<Record<string, Partial<EmailTemplate>>>({});

  const { data: templates, isLoading } = useQuery({
    queryKey: ["email-templates"],
    queryFn: async () => {
      if (backend === "worker") return workerApi.list();
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
    mutationFn: async ({ id, expectedUpdatedAt, updates }: { id: string; expectedUpdatedAt: string; updates: Partial<EmailTemplate> }) => {
      if (backend === "worker") {
        return workerApi.update({
          id,
          expectedUpdatedAt,
          subject: updates.subject ?? "",
          bodyText: updates.body_text ?? "",
          buttonText: updates.button_text ?? "",
        });
      }
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
    onSuccess: (_data, variables) => {
      setEditingTemplates((previous) => {
        const next = { ...previous };
        delete next[variables.id];
        return next;
      });
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
      expectedUpdatedAt: template.updated_at,
      updates: {
        subject: updates.subject ?? template.subject,
        body_text: updates.body_text ?? template.body_text,
        button_text: updates.button_text ?? template.button_text,
      },
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

  if (!templates) {
    return (
      <div className="py-8 text-sm text-muted-foreground" role="alert">
        メールテンプレートを読み込めませんでした。管理者権限と接続先を確認してください。
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {backend === "worker" && (
        <p className="rounded-md border border-border/60 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          認証メールテンプレートはCloudflare D1から読み込みます。変更は管理者MFAで保護され、送信処理も同じテンプレートを参照します。
        </p>
      )}
      <Tabs value={selectedType} onValueChange={setSelectedType}>
        <TabsList className="flex w-full flex-wrap gap-2 rounded-2xl bg-muted/30 p-2">
          {EMAIL_TYPES.map((type) => (
            <TabsTrigger
              key={type.value}
              value={type.value}
              className="flex-1 rounded-xl px-5 py-3 text-sm font-medium transition-all data-[state=active]:bg-card data-[state=active]:text-foreground sm:flex-none"
            >
              {type.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {EMAIL_TYPES.map((type) => (
          <TabsContent key={type.value} value={type.value} className="mt-6 space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              {LANGUAGES.map((lang) => {
                const template = getTemplate(type.value, lang.value);
                if (!template) return null;

                return (
                  <Card key={lang.value} className="border-border/60 shadow-sm">
                    <CardHeader className="space-y-3 p-6 pb-4 sm:flex sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
                      <div>
                        <CardTitle className="text-lg font-semibold text-foreground">
                          {lang.label}
                        </CardTitle>
                        <CardDescription>
                          件名・本文・ボタンテキストを編集します。
                        </CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="rounded-full px-2 py-0.5">
                          {lang.value.toUpperCase()}
                        </Badge>
                        {hasChanges(template.id) && (
                          <Badge variant="secondary" className="rounded-full px-2 py-0.5 text-amber-600">
                            未保存の変更
                          </Badge>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4 p-6 pt-0">
                      <div className="space-y-2">
                        <Label htmlFor={`subject-${template.id}`}>件名</Label>
                        <Input
                          id={`subject-${template.id}`}
                          value={getEditingValue(template, "subject")}
                          onChange={(e) => handleChange(template.id, "subject", e.target.value)}
                          placeholder="件名を入力"
                          className="bg-background"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor={`body-${template.id}`}>本文</Label>
                        <Textarea
                          id={`body-${template.id}`}
                          value={getEditingValue(template, "body_text")}
                          onChange={(e) => handleChange(template.id, "body_text", e.target.value)}
                          placeholder="本文を入力"
                          className="bg-background"
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
                          className="bg-background"
                        />
                      </div>

                      <div className="flex flex-wrap gap-2 pt-2">
                        <Button
                          size="sm"
                          onClick={() => handleSave(template)}
                          disabled={!hasChanges(template.id) || updateMutation.isPending}
                          className="gap-2"
                        >
                          {updateMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Save className="h-4 w-4" />
                          )}
                          保存
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleReset(template.id)}
                          disabled={!hasChanges(template.id)}
                          className="gap-2"
                        >
                          <RotateCcw className="h-4 w-4" />
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
