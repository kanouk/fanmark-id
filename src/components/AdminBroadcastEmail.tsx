import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { toast } from "sonner";
import {
  Mail,
  Send,
  Loader2,
  Plus,
  Eye,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  Filter,
  ChevronDown,
  Users,
  TestTube,
} from "lucide-react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { useLanguages } from "@/hooks/useLanguages";

type BroadcastStatus = "draft" | "scheduled" | "sending" | "completed" | "failed" | "cancelled";

interface RecipientFilter {
  plan_types?: string[];
  languages?: string[];
  registered_after?: string;
  registered_before?: string;
}

interface BroadcastEmail {
  id: string;
  subject: string;
  body_text: string;
  email_type: string;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  status: BroadcastStatus;
  recipient_filter: RecipientFilter | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface EmailTemplate {
  id: string;
  email_type: string;
  language: string;
  subject: string;
  body_text: string;
}

const EMAIL_TYPES = [
  { value: "broadcast_announcement", label: "お知らせ" },
  { value: "broadcast_maintenance", label: "メンテナンス通知" },
  { value: "broadcast_security", label: "セキュリティ通知" },
];

const PLAN_TYPES = [
  { value: "free", label: "Free" },
  { value: "creator", label: "Creator" },
  { value: "max", label: "Max" },
  { value: "business", label: "Business" },
  { value: "enterprise", label: "Enterprise" },
  { value: "admin", label: "Admin" },
];

const STATUS_CONFIG: Record<BroadcastStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }> = {
  draft: { label: "下書き", variant: "outline", icon: <Clock className="h-3 w-3" /> },
  scheduled: { label: "予約済み", variant: "secondary", icon: <Clock className="h-3 w-3" /> },
  sending: { label: "送信中", variant: "default", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  completed: { label: "完了", variant: "default", icon: <CheckCircle className="h-3 w-3" /> },
  failed: { label: "失敗", variant: "destructive", icon: <XCircle className="h-3 w-3" /> },
  cancelled: { label: "キャンセル", variant: "secondary", icon: <XCircle className="h-3 w-3" /> },
};

export function AdminBroadcastEmail() {
  const queryClient = useQueryClient();
  const { activeLanguages } = useLanguages();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isTestSendOpen, setIsTestSendOpen] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [selectedBroadcast, setSelectedBroadcast] = useState<BroadcastEmail | null>(null);
  const [estimatedCount, setEstimatedCount] = useState<number | null>(null);
  const [isEstimating, setIsEstimating] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [testLanguage, setTestLanguage] = useState("ja");
  const [formData, setFormData] = useState({
    email_type: "broadcast_announcement",
    subject: "",
    body_text: "",
  });
  const [filterData, setFilterData] = useState<RecipientFilter>({
    plan_types: [],
    languages: [],
    registered_after: "",
    registered_before: "",
  });

  // Fetch broadcast emails
  const { data: broadcasts, isLoading } = useQuery({
    queryKey: ["broadcast-emails"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("broadcast_emails")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      return data as BroadcastEmail[];
    },
    refetchInterval: 5000, // Poll every 5 seconds for status updates
  });

  // Fetch templates for preview
  const { data: templates } = useQuery({
    queryKey: ["email-templates", "broadcast"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_templates")
        .select("*")
        .like("email_type", "broadcast_%")
        .eq("is_active", true);

      if (error) throw error;
      return data as EmailTemplate[];
    },
  });

  // Estimate recipient count based on filters
  const estimateRecipients = async () => {
    setIsEstimating(true);
    try {
      let query = supabase.from("user_settings").select("user_id", { count: "exact", head: true });

      if (filterData.plan_types && filterData.plan_types.length > 0) {
        // Cast to the expected type for Supabase
        query = query.in("plan_type", filterData.plan_types as ("free" | "creator" | "max" | "business" | "enterprise" | "admin")[]);
      }
      if (filterData.languages && filterData.languages.length > 0) {
        query = query.in("preferred_language", filterData.languages as ("en" | "ja" | "ko" | "id")[]);
      }
      if (filterData.registered_after) {
        query = query.gte("created_at", filterData.registered_after);
      }
      if (filterData.registered_before) {
        query = query.lte("created_at", filterData.registered_before);
      }

      const { count, error } = await query;
      if (error) throw error;
      setEstimatedCount(count ?? 0);
    } catch (err) {
      console.error("Failed to estimate recipients:", err);
      toast.error("対象者数の取得に失敗しました");
    } finally {
      setIsEstimating(false);
    }
  };

  // Re-estimate when filters change
  useEffect(() => {
    const hasFilters =
      (filterData.plan_types && filterData.plan_types.length > 0) ||
      (filterData.languages && filterData.languages.length > 0) ||
      filterData.registered_after ||
      filterData.registered_before;

    if (hasFilters) {
      estimateRecipients();
    } else {
      setEstimatedCount(null);
    }
  }, [filterData]);

  // Create broadcast mutation
  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session?.user) throw new Error("Not authenticated");

      // Build recipient filter (only include non-empty filters)
      const recipientFilter: RecipientFilter = {};
      if (filterData.plan_types && filterData.plan_types.length > 0) {
        recipientFilter.plan_types = filterData.plan_types;
      }
      if (filterData.languages && filterData.languages.length > 0) {
        recipientFilter.languages = filterData.languages;
      }
      if (filterData.registered_after) {
        recipientFilter.registered_after = filterData.registered_after;
      }
      if (filterData.registered_before) {
        recipientFilter.registered_before = filterData.registered_before;
      }

      const hasFilter = Object.keys(recipientFilter).length > 0;

      const { data: result, error } = await supabase
        .from("broadcast_emails")
        .insert([{
          email_type: data.email_type,
          subject: data.subject,
          body_text: data.body_text,
          created_by: session.session.user.id,
          status: "draft" as const,
          recipient_filter: hasFilter ? recipientFilter as unknown as null : null,
        }])
        .select()
        .single();

      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["broadcast-emails"] });
      setIsCreateOpen(false);
      setFormData({ email_type: "broadcast_announcement", subject: "", body_text: "" });
      setFilterData({ plan_types: [], languages: [], registered_after: "", registered_before: "" });
      setEstimatedCount(null);
      toast.success("一括メールを作成しました");
    },
    onError: (error) => {
      toast.error(`作成失敗: ${error.message}`);
    },
  });

  // Send broadcast mutation
  const sendMutation = useMutation({
    mutationFn: async (broadcastId: string) => {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session?.access_token) throw new Error("Not authenticated");

      const response = await supabase.functions.invoke("send-broadcast-email", {
        body: { broadcastId },
      });

      if (response.error) throw response.error;
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["broadcast-emails"] });
      setIsConfirmOpen(false);
      setSelectedBroadcast(null);
      toast.success(data.message || "送信を開始しました");
    },
    onError: (error) => {
      toast.error(`送信失敗: ${error.message}`);
    },
  });

  // Test send mutation
  const testSendMutation = useMutation({
    mutationFn: async ({ broadcastId, email, language }: { broadcastId: string; email: string; language: string }) => {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session?.access_token) throw new Error("Not authenticated");

      const response = await supabase.functions.invoke("send-broadcast-email", {
        body: { broadcastId, testMode: true, testEmail: email, testLanguage: language },
      });

      if (response.error) throw response.error;
      return response.data;
    },
    onSuccess: (data) => {
      setIsTestSendOpen(false);
      setTestEmail("");
      toast.success(data.message || "テストメールを送信しました");
    },
    onError: (error) => {
      toast.error(`テスト送信失敗: ${error.message}`);
    },
  });

  const handleCreate = () => {
    if (!formData.subject.trim()) {
      toast.error("件名を入力してください");
      return;
    }
    createMutation.mutate(formData);
  };

  const handleSend = () => {
    if (!selectedBroadcast) return;
    sendMutation.mutate(selectedBroadcast.id);
  };

  const openConfirmDialog = (broadcast: BroadcastEmail) => {
    setSelectedBroadcast(broadcast);
    setIsConfirmOpen(true);
  };

  const openPreviewDialog = (broadcast: BroadcastEmail) => {
    setSelectedBroadcast(broadcast);
    setIsPreviewOpen(true);
  };

  const openTestSendDialog = (broadcast: BroadcastEmail) => {
    setSelectedBroadcast(broadcast);
    setIsTestSendOpen(true);
  };

  const handleTestSend = () => {
    if (!selectedBroadcast || !testEmail.trim()) {
      toast.error("テスト送信先のメールアドレスを入力してください");
      return;
    }
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(testEmail.trim())) {
      toast.error("有効なメールアドレスを入力してください");
      return;
    }
    testSendMutation.mutate({
      broadcastId: selectedBroadcast.id,
      email: testEmail.trim(),
      language: testLanguage,
    });
  };

  const getTemplatePreview = (emailType: string, language: string) => {
    return templates?.find(
      (t) => t.email_type === emailType && t.language === language
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">一括メール送信</h3>
          <p className="text-sm text-muted-foreground">
            全ユーザーへのお知らせ・メンテナンス通知を送信
          </p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          新規作成
        </Button>
      </div>

      {/* Broadcast List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4" />
            送信履歴
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : broadcasts?.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              送信履歴がありません
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>タイプ</TableHead>
                  <TableHead>件名</TableHead>
                  <TableHead>ステータス</TableHead>
                  <TableHead className="text-right">送信数</TableHead>
                  <TableHead>作成日時</TableHead>
                  <TableHead className="text-right">アクション</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {broadcasts?.map((broadcast) => {
                  const statusConfig = STATUS_CONFIG[broadcast.status as BroadcastStatus];
                  const emailType = EMAIL_TYPES.find(
                    (t) => t.value === broadcast.email_type
                  );

                  return (
                    <TableRow key={broadcast.id}>
                      <TableCell>
                        <Badge variant="outline">{emailType?.label || broadcast.email_type}</Badge>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate font-medium">
                        {broadcast.subject || "(テンプレート使用)"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={statusConfig?.variant}
                          className="gap-1"
                        >
                          {statusConfig?.icon}
                          {statusConfig?.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {broadcast.status === "sending" ? (
                          <span className="text-muted-foreground">
                            {broadcast.sent_count} / {broadcast.total_recipients || "?"}
                          </span>
                        ) : broadcast.status === "completed" || broadcast.status === "failed" ? (
                          <span>
                            <span className="text-green-600">{broadcast.sent_count}</span>
                            {broadcast.failed_count > 0 && (
                              <span className="text-destructive">
                                {" "}/ {broadcast.failed_count} 失敗
                              </span>
                            )}
                          </span>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {format(new Date(broadcast.created_at), "MM/dd HH:mm", {
                          locale: ja,
                        })}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openPreviewDialog(broadcast)}
                            title="プレビュー"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {broadcast.status === "draft" && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openTestSendDialog(broadcast)}
                                title="テスト送信"
                              >
                                <TestTube className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="default"
                                size="sm"
                                onClick={() => openConfirmDialog(broadcast)}
                                title="送信開始"
                              >
                                <Send className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>一括メール作成</DialogTitle>
            <DialogDescription>
              全ユーザーに送信するメールを作成します。ユーザーの言語設定に応じて自動的にテンプレートが選択されます。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>メールタイプ</Label>
              <Select
                value={formData.email_type}
                onValueChange={(value) =>
                  setFormData((prev) => ({ ...prev, email_type: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EMAIL_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Recipient Filters */}
            <Collapsible open={isFilterOpen} onOpenChange={setIsFilterOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="outline" className="w-full justify-between">
                  <span className="flex items-center gap-2">
                    <Filter className="h-4 w-4" />
                    受信者フィルター
                    {estimatedCount !== null && (
                      <Badge variant="secondary" className="ml-2">
                        <Users className="mr-1 h-3 w-3" />
                        {estimatedCount}人
                      </Badge>
                    )}
                  </span>
                  <ChevronDown className={`h-4 w-4 transition-transform ${isFilterOpen ? "rotate-180" : ""}`} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-4 space-y-4 rounded-lg border bg-muted/30 p-4">
                {/* Plan Type Filter */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">プランタイプ</Label>
                  <div className="flex flex-wrap gap-2">
                    {PLAN_TYPES.map((plan) => (
                      <label key={plan.value} className="flex items-center gap-2">
                        <Checkbox
                          checked={filterData.plan_types?.includes(plan.value) || false}
                          onCheckedChange={(checked) => {
                            setFilterData((prev) => ({
                              ...prev,
                              plan_types: checked
                                ? [...(prev.plan_types || []), plan.value]
                                : (prev.plan_types || []).filter((p) => p !== plan.value),
                            }));
                          }}
                        />
                        <span className="text-sm">{plan.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Language Filter */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">言語設定</Label>
                  <div className="flex flex-wrap gap-2">
                    {activeLanguages.map((lang) => (
                      <label key={lang.code} className="flex items-center gap-2">
                        <Checkbox
                          checked={filterData.languages?.includes(lang.code) || false}
                          onCheckedChange={(checked) => {
                            setFilterData((prev) => ({
                              ...prev,
                              languages: checked
                                ? [...(prev.languages || []), lang.code]
                                : (prev.languages || []).filter((l) => l !== lang.code),
                            }));
                          }}
                        />
                        <span className="text-sm">{lang.nativeLabel}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Registration Date Filter */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">登録日（以降）</Label>
                    <Input
                      type="date"
                      value={filterData.registered_after || ""}
                      onChange={(e) =>
                        setFilterData((prev) => ({
                          ...prev,
                          registered_after: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">登録日（以前）</Label>
                    <Input
                      type="date"
                      value={filterData.registered_before || ""}
                      onChange={(e) =>
                        setFilterData((prev) => ({
                          ...prev,
                          registered_before: e.target.value,
                        }))
                      }
                    />
                  </div>
                </div>

                {/* Estimate Display */}
                <div className="flex items-center justify-between rounded-lg bg-background p-3">
                  <span className="text-sm text-muted-foreground">対象ユーザー数:</span>
                  {isEstimating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : estimatedCount !== null ? (
                    <span className="font-medium">{estimatedCount}人</span>
                  ) : (
                    <span className="text-muted-foreground">全ユーザー</span>
                  )}
                </div>

                {/* Clear Filters */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFilterData({ plan_types: [], languages: [], registered_after: "", registered_before: "" });
                    setEstimatedCount(null);
                  }}
                >
                  フィルターをクリア
                </Button>
              </CollapsibleContent>
            </Collapsible>

            <div className="space-y-2">
              <Label>件名（オプション: 空の場合はテンプレートを使用）</Label>
              <Input
                value={formData.subject}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, subject: e.target.value }))
                }
                placeholder="【Fanmark】重要なお知らせ"
              />
            </div>

            <div className="space-y-2">
              <Label>本文（オプション: 空の場合はテンプレートを使用）</Label>
              <Textarea
                value={formData.body_text}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, body_text: e.target.value }))
                }
                placeholder="お知らせの内容を入力..."
                rows={6}
              />
            </div>

            {/* Template Preview */}
            <div className="rounded-lg border bg-muted/50 p-4">
              <p className="mb-2 text-sm font-medium">テンプレートプレビュー（日本語）</p>
              {(() => {
                const template = getTemplatePreview(formData.email_type, "ja");
                return template ? (
                  <div className="space-y-1 text-sm text-muted-foreground">
                    <p>
                      <span className="font-medium">件名:</span>{" "}
                      {formData.subject || template.subject}
                    </p>
                    <p className="whitespace-pre-wrap">
                      <span className="font-medium">本文:</span>{" "}
                      {formData.body_text || template.body_text}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    テンプレートが見つかりません
                  </p>
                );
              })()}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              キャンセル
            </Button>
            <Button
              onClick={handleCreate}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              作成
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Send Dialog */}
      <Dialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              送信確認
            </DialogTitle>
            <DialogDescription>
              この操作は取り消せません。全ユーザーにメールが送信されます。
            </DialogDescription>
          </DialogHeader>

          {selectedBroadcast && (
            <div className="space-y-2 rounded-lg border bg-muted/50 p-4">
              <p className="text-sm">
                <span className="font-medium">タイプ:</span>{" "}
                {EMAIL_TYPES.find((t) => t.value === selectedBroadcast.email_type)
                  ?.label || selectedBroadcast.email_type}
              </p>
              <p className="text-sm">
                <span className="font-medium">件名:</span>{" "}
                {selectedBroadcast.subject || "(テンプレート使用)"}
              </p>
              {selectedBroadcast.recipient_filter && Object.keys(selectedBroadcast.recipient_filter).length > 0 && (
                <div className="text-sm">
                  <span className="font-medium">フィルター:</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {selectedBroadcast.recipient_filter.plan_types?.map((p) => (
                      <Badge key={p} variant="outline" className="text-xs">{p}</Badge>
                    ))}
                    {selectedBroadcast.recipient_filter.languages?.map((l) => (
                      <Badge key={l} variant="outline" className="text-xs">{l}</Badge>
                    ))}
                    {selectedBroadcast.recipient_filter.registered_after && (
                      <Badge variant="outline" className="text-xs">
                        {selectedBroadcast.recipient_filter.registered_after}以降
                      </Badge>
                    )}
                    {selectedBroadcast.recipient_filter.registered_before && (
                      <Badge variant="outline" className="text-xs">
                        {selectedBroadcast.recipient_filter.registered_before}以前
                      </Badge>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsConfirmOpen(false)}>
              キャンセル
            </Button>
            <Button
              variant="destructive"
              onClick={handleSend}
              disabled={sendMutation.isPending}
            >
              {sendMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              送信開始
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>メール詳細</DialogTitle>
          </DialogHeader>

          {selectedBroadcast && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">ステータス</p>
                  <Badge
                    variant={STATUS_CONFIG[selectedBroadcast.status as BroadcastStatus]?.variant}
                    className="mt-1 gap-1"
                  >
                    {STATUS_CONFIG[selectedBroadcast.status as BroadcastStatus]?.icon}
                    {STATUS_CONFIG[selectedBroadcast.status as BroadcastStatus]?.label}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">送信結果</p>
                  <p className="mt-1 text-sm">
                    成功: {selectedBroadcast.sent_count} / 失敗:{" "}
                    {selectedBroadcast.failed_count}
                  </p>
                </div>
              </div>

              <div>
                <p className="text-sm text-muted-foreground">件名</p>
                <p className="mt-1">{selectedBroadcast.subject || "(テンプレート使用)"}</p>
              </div>

              <div>
                <p className="text-sm text-muted-foreground">本文</p>
                <p className="mt-1 whitespace-pre-wrap rounded-lg border bg-muted/50 p-3 text-sm">
                  {selectedBroadcast.body_text || "(テンプレート使用)"}
                </p>
              </div>

              {selectedBroadcast.started_at && (
                <div>
                  <p className="text-sm text-muted-foreground">送信開始</p>
                  <p className="mt-1 text-sm">
                    {format(new Date(selectedBroadcast.started_at), "yyyy/MM/dd HH:mm:ss", {
                      locale: ja,
                    })}
                  </p>
                </div>
              )}

              {selectedBroadcast.completed_at && (
                <div>
                  <p className="text-sm text-muted-foreground">完了</p>
                  <p className="mt-1 text-sm">
                    {format(new Date(selectedBroadcast.completed_at), "yyyy/MM/dd HH:mm:ss", {
                      locale: ja,
                    })}
                  </p>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPreviewOpen(false)}>
              閉じる
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Test Send Dialog */}
      <Dialog open={isTestSendOpen} onOpenChange={setIsTestSendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TestTube className="h-5 w-5 text-primary" />
              テスト送信
            </DialogTitle>
            <DialogDescription>
              指定したメールアドレスにテストメールを送信します。実際の送信前に内容を確認できます。
            </DialogDescription>
          </DialogHeader>

          {selectedBroadcast && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/50 p-4">
                <p className="text-sm">
                  <span className="font-medium">タイプ:</span>{" "}
                  {EMAIL_TYPES.find((t) => t.value === selectedBroadcast.email_type)?.label || selectedBroadcast.email_type}
                </p>
                <p className="text-sm">
                  <span className="font-medium">件名:</span>{" "}
                  {selectedBroadcast.subject || "(テンプレート使用)"}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="test-email">送信先メールアドレス</Label>
                <Input
                  id="test-email"
                  type="email"
                  placeholder="test@example.com"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>テンプレート言語</Label>
                <Select value={testLanguage} onValueChange={setTestLanguage}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {activeLanguages.map((lang) => (
                      <SelectItem key={lang.code} value={lang.code}>
                        {lang.nativeLabel} ({lang.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  選択した言語のテンプレートでメールが送信されます
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsTestSendOpen(false)}>
              キャンセル
            </Button>
            <Button
              onClick={handleTestSend}
              disabled={testSendMutation.isPending || !testEmail.trim()}
            >
              {testSendMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              <TestTube className="mr-2 h-4 w-4" />
              テスト送信
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
