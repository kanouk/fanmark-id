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
import { toast } from "sonner";
import { Loader2, Send, RefreshCw } from "lucide-react";

const AdminNotificationManager = () => {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState("");
  const [eventType, setEventType] = useState("");
  const [payload, setPayload] = useState("{}");

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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>通知管理</CardTitle>
          <CardDescription>手動通知送信と通知ログの管理</CardDescription>
        </CardHeader>
      </Card>

      <Tabs defaultValue="send" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="send">手動送信</TabsTrigger>
          <TabsTrigger value="events">イベントログ</TabsTrigger>
          <TabsTrigger value="notifications">配信済み通知</TabsTrigger>
          <TabsTrigger value="rules">ルール一覧</TabsTrigger>
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
                    <SelectItem value="favorite_fanmark_available">お気に入りファンマーク利用可能</SelectItem>
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
      </Tabs>
    </div>
  );
};

export default AdminNotificationManager;
