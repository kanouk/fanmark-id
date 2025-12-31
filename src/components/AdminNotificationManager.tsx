import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, Send, RefreshCw, Pencil } from "lucide-react";

interface NotificationTemplate {
  id: string;
  template_id: string;
  language: string;
  channel: string;
  version: number;
  title: string | null;
  body: string;
  summary: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const AdminNotificationManager = () => {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState("");
  const [eventType, setEventType] = useState("");
  const [payload, setPayload] = useState("{}");
  
  // Template editing state
  const [editingTemplate, setEditingTemplate] = useState<NotificationTemplate | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);
  const [templateLanguageFilter, setTemplateLanguageFilter] = useState<string>("all");

  // 手動通知送信
  const sendNotificationMutation = useMutation({
    mutationFn: async () => {
      let parsedPayload;
      try {
        parsedPayload = JSON.parse(payload);
      } catch (e) {
        throw new Error("無効なJSON形式です");
      }

      const { data, error } = await supabase.rpc('create_notification_event', {
        event_type_param: eventType,
        payload_param: parsedPayload,
        source_param: 'admin_manual',
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("通知イベントを作成しました");
      queryClient.invalidateQueries({ queryKey: ['notification-events'] });
      setUserId("");
      setEventType("");
      setPayload("{}");
    },
    onError: (error: Error) => {
      toast.error(`エラー: ${error.message}`);
    },
  });

  // 通知イベントログ取得
  const { data: events, isLoading: eventsLoading, refetch: refetchEvents } = useQuery({
    queryKey: ['notification-events'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notification_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      
      if (error) throw error;
      return data;
    },
  });

  // 配信済み通知取得
  const { data: notifications, isLoading: notificationsLoading, refetch: refetchNotifications } = useQuery({
    queryKey: ['notifications-log'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      
      if (error) throw error;
      return data;
    },
  });

  // 通知ルール取得
  const { data: rules, isLoading: rulesLoading, refetch: refetchRules } = useQuery({
    queryKey: ['notification-rules'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notification_rules')
        .select('*')
        .order('priority', { ascending: true });
      
      if (error) throw error;
      return data;
    },
  });

  // テンプレート取得
  const { data: templates, isLoading: templatesLoading, refetch: refetchTemplates } = useQuery({
    queryKey: ['notification-templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notification_templates')
        .select('*')
        .order('template_id')
        .order('language');
      
      if (error) throw error;
      return data as NotificationTemplate[];
    },
  });

  // ルール有効/無効切り替え
  const toggleRuleMutation = useMutation({
    mutationFn: async ({ ruleId, enabled }: { ruleId: string; enabled: boolean }) => {
      const { error } = await supabase
        .from('notification_rules')
        .update({ enabled: !enabled })
        .eq('id', ruleId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("ルールを更新しました");
      queryClient.invalidateQueries({ queryKey: ['notification-rules'] });
    },
    onError: (error: Error) => {
      toast.error(`エラー: ${error.message}`);
    },
  });

  // テンプレート更新
  const updateTemplateMutation = useMutation({
    mutationFn: async () => {
      if (!editingTemplate) throw new Error("テンプレートが選択されていません");
      
      const { error } = await supabase
        .from('notification_templates')
        .update({
          title: editTitle || null,
          body: editBody,
          summary: editSummary || null,
          is_active: editIsActive,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editingTemplate.id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("テンプレートを更新しました");
      queryClient.invalidateQueries({ queryKey: ['notification-templates'] });
      setEditingTemplate(null);
    },
    onError: (error: Error) => {
      toast.error(`エラー: ${error.message}`);
    },
  });

  const openEditDialog = (template: NotificationTemplate) => {
    setEditingTemplate(template);
    setEditTitle(template.title || "");
    setEditBody(template.body);
    setEditSummary(template.summary || "");
    setEditIsActive(template.is_active);
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      pending: "secondary",
      processing: "default",
      completed: "default",
      delivered: "default",
      failed: "destructive",
    };
    return <Badge variant={variants[status] || "outline"}>{status}</Badge>;
  };

  const getLanguageLabel = (lang: string) => {
    const labels: Record<string, string> = { ja: "日本語", en: "English", ko: "한국어", id: "Indonesia" };
    return labels[lang] || lang;
  };

  const filteredTemplates = templates?.filter(t => 
    templateLanguageFilter === "all" || t.language === templateLanguageFilter
  );

  // Group templates by template_id for display
  const groupedTemplates = filteredTemplates?.reduce((acc, template) => {
    if (!acc[template.template_id]) {
      acc[template.template_id] = [];
    }
    acc[template.template_id].push(template);
    return acc;
  }, {} as Record<string, NotificationTemplate[]>);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>通知管理</CardTitle>
          <CardDescription>手動通知送信と通知ログの管理</CardDescription>
        </CardHeader>
      </Card>

      <Tabs defaultValue="send" className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="send">手動送信</TabsTrigger>
          <TabsTrigger value="events">イベントログ</TabsTrigger>
          <TabsTrigger value="notifications">配信済み通知</TabsTrigger>
          <TabsTrigger value="rules">ルール一覧</TabsTrigger>
          <TabsTrigger value="templates">テンプレート</TabsTrigger>
        </TabsList>

        <TabsContent value="send">
          <Card>
            <CardHeader>
              <CardTitle>手動通知送信</CardTitle>
              <CardDescription>通知イベントを手動で作成します</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="eventType">イベントタイプ</Label>
                <Select value={eventType} onValueChange={setEventType}>
                  <SelectTrigger id="eventType">
                    <SelectValue placeholder="イベントタイプを選択" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="license_grace_started">ライセンス猶予期間開始</SelectItem>
                    <SelectItem value="license_expired">ライセンス期限切れ</SelectItem>
                    <SelectItem value="favorite_fanmark_available">お気に入りファンマ返却通知</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="payload">ペイロード (JSON)</Label>
                <Textarea
                  id="payload"
                  value={payload}
                  onChange={(e) => setPayload(e.target.value)}
                  placeholder='{"user_id": "uuid", "fanmark_name": "🎉"}'
                  className="font-mono text-sm"
                  rows={6}
                />
              </div>

              <Button
                onClick={() => sendNotificationMutation.mutate()}
                disabled={!eventType || sendNotificationMutation.isPending}
              >
                {sendNotificationMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <Send className="mr-2 h-4 w-4" />
                送信
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="events">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>通知イベントログ</CardTitle>
                  <CardDescription>最新100件のイベント</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => refetchEvents()}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {eventsLoading ? (
                <div className="flex justify-center p-8">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>イベントタイプ</TableHead>
                        <TableHead>ステータス</TableHead>
                        <TableHead>ソース</TableHead>
                        <TableHead>作成日時</TableHead>
                        <TableHead>処理日時</TableHead>
                        <TableHead>エラー</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {events?.map((event) => (
                        <TableRow key={event.id}>
                          <TableCell className="font-medium">{event.event_type}</TableCell>
                          <TableCell>{getStatusBadge(event.status)}</TableCell>
                          <TableCell>{event.source}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {new Date(event.created_at).toLocaleString('ja-JP')}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {event.processed_at ? new Date(event.processed_at).toLocaleString('ja-JP') : '-'}
                          </TableCell>
                          <TableCell className="text-sm text-destructive">
                            {event.error_reason || '-'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>配信済み通知</CardTitle>
                  <CardDescription>最新100件の通知</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => refetchNotifications()}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {notificationsLoading ? (
                <div className="flex justify-center p-8">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ユーザーID</TableHead>
                        <TableHead>チャンネル</TableHead>
                        <TableHead>ステータス</TableHead>
                        <TableHead>配信日時</TableHead>
                        <TableHead>既読日時</TableHead>
                        <TableHead>優先度</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {notifications?.map((notif) => (
                        <TableRow key={notif.id}>
                          <TableCell className="font-mono text-xs">
                            {notif.user_id.substring(0, 8)}...
                          </TableCell>
                          <TableCell>{notif.channel}</TableCell>
                          <TableCell>{getStatusBadge(notif.status)}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {notif.delivered_at ? new Date(notif.delivered_at).toLocaleString('ja-JP') : '-'}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {notif.read_at ? new Date(notif.read_at).toLocaleString('ja-JP') : '未読'}
                          </TableCell>
                          <TableCell>{notif.priority}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rules">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>通知ルール一覧</CardTitle>
                  <CardDescription>通知配信ルールの管理</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => refetchRules()}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {rulesLoading ? (
                <div className="flex justify-center p-8">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>イベントタイプ</TableHead>
                        <TableHead>チャンネル</TableHead>
                        <TableHead>テンプレートID</TableHead>
                        <TableHead>優先度</TableHead>
                        <TableHead>遅延(秒)</TableHead>
                        <TableHead>有効</TableHead>
                        <TableHead>操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rules?.map((rule) => (
                        <TableRow key={rule.id}>
                          <TableCell className="font-medium">{rule.event_type}</TableCell>
                          <TableCell>{rule.channel}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {rule.template_id.substring(0, 8)}...
                          </TableCell>
                          <TableCell>{rule.priority}</TableCell>
                          <TableCell>{rule.delay_seconds}</TableCell>
                          <TableCell>
                            <Badge variant={rule.enabled ? "default" : "secondary"}>
                              {rule.enabled ? '有効' : '無効'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => toggleRuleMutation.mutate({ ruleId: rule.id, enabled: rule.enabled })}
                              disabled={toggleRuleMutation.isPending}
                            >
                              {rule.enabled ? '無効化' : '有効化'}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="templates">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>通知テンプレート</CardTitle>
                  <CardDescription>
                    通知メッセージのテンプレートを管理します。プレースホルダ: {`{{fanmark_name}}, {{license_end}}, {{grace_expires_at}}`} 等
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Select value={templateLanguageFilter} onValueChange={setTemplateLanguageFilter}>
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">すべて</SelectItem>
                      <SelectItem value="ja">日本語</SelectItem>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="ko">한국어</SelectItem>
                      <SelectItem value="id">Indonesia</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" onClick={() => refetchTemplates()}>
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {templatesLoading ? (
                <div className="flex justify-center p-8">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>テンプレートID</TableHead>
                        <TableHead>言語</TableHead>
                        <TableHead>Ch</TableHead>
                        <TableHead>Ver</TableHead>
                        <TableHead>タイトル</TableHead>
                        <TableHead className="max-w-[300px]">本文</TableHead>
                        <TableHead>有効</TableHead>
                        <TableHead>操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredTemplates?.map((template) => (
                        <TableRow key={template.id}>
                          <TableCell className="font-mono text-xs">
                            {template.template_id.substring(0, 8)}...
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{getLanguageLabel(template.language)}</Badge>
                          </TableCell>
                          <TableCell>{template.channel}</TableCell>
                          <TableCell>{template.version}</TableCell>
                          <TableCell className="max-w-[150px] truncate">
                            {template.title || '-'}
                          </TableCell>
                          <TableCell className="max-w-[300px] truncate text-sm text-muted-foreground">
                            {template.body.substring(0, 50)}{template.body.length > 50 ? '...' : ''}
                          </TableCell>
                          <TableCell>
                            <Badge variant={template.is_active ? "default" : "secondary"}>
                              {template.is_active ? '有効' : '無効'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openEditDialog(template)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Template Edit Dialog */}
      <Dialog open={!!editingTemplate} onOpenChange={(open) => !open && setEditingTemplate(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>テンプレート編集</DialogTitle>
            <DialogDescription>
              テンプレートID: {editingTemplate?.template_id.substring(0, 8)}... | 
              言語: {editingTemplate && getLanguageLabel(editingTemplate.language)} | 
              Ver: {editingTemplate?.version}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-title">タイトル</Label>
              <Input
                id="edit-title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="通知タイトル"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-body">本文</Label>
              <Textarea
                id="edit-body"
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                placeholder="通知本文"
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                使用可能なプレースホルダ: {`{{fanmark_name}}, {{fanmark_short_id}}, {{license_end}}, {{grace_expires_at}}, {{reason}}`}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-summary">サマリー（オプション）</Label>
              <Textarea
                id="edit-summary"
                value={editSummary}
                onChange={(e) => setEditSummary(e.target.value)}
                placeholder="短い要約（任意）"
                rows={2}
              />
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="edit-active"
                checked={editIsActive}
                onCheckedChange={setEditIsActive}
              />
              <Label htmlFor="edit-active">有効</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingTemplate(null)}>
              キャンセル
            </Button>
            <Button 
              onClick={() => updateTemplateMutation.mutate()}
              disabled={updateTemplateMutation.isPending || !editBody}
            >
              {updateTemplateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminNotificationManager;
