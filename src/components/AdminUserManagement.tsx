import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, RefreshCcw, ShieldOff, ShieldCheck, KeyRound, Search, Users2, Crown } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type PlanType = "free" | "creator" | "business" | "enterprise" | "admin";

type ListedUser = {
  userId: string;
  email: string | null;
  emailConfirmedAt: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
  status: "active" | "suspended";
  bannedUntil: string | null;
  displayName: string | null;
  username: string;
  planType: PlanType;
  preferredLanguage: string;
  profileUpdatedAt: string;
  licenseCounts: {
    active: number;
    grace: number;
    expired: number;
  };
  enterpriseSettings: {
    custom_fanmarks_limit: number | null;
    custom_pricing: number | null;
    notes: string | null;
  } | null;
};

type ListUsersResponse = {
  data: ListedUser[];
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
  };
  filters: {
    search: string | null;
    plans: string[] | null;
    status: "active" | "suspended" | null;
  };
  meta: {
    totalMatchedBeforeStatus: number | null;
  };
};

type DetailResponse = {
  auth: {
    email: string | null;
    emailConfirmedAt: string | null;
    createdAt: string | null;
    lastSignInAt: string | null;
    phone: string | null;
    status: "active" | "suspended";
    bannedUntil: string | null;
    factors: { type: string; createdAt: string | null }[];
  };
  profile: {
    userId: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    planType: PlanType;
    preferredLanguage: string;
    createdAt: string;
    updatedAt: string;
  };
  enterpriseSettings: {
    customFanmarksLimit: number | null;
    customPricing: number | null;
    notes: string | null;
    updatedAt: string | null;
  } | null;
  licenseSummary: {
    active: number;
    grace: number;
    expired: number;
    total: number;
  };
  recentFanmarks: Array<{
    licenseId: string;
    status: string;
    licenseEnd: string;
    graceExpiresAt: string | null;
    planExcluded: boolean;
    excludedAt: string | null;
    excludedFromPlan: string | null;
    fanmarkId: string;
    emoji: string;
    fanmarkName: string | null;
    accessType: string | null;
  }>;
  recentAuditLogs: Array<{
    id: string;
    userId: string | null;
    action: string;
    resourceType: string;
    resourceId: string | null;
    metadata: Record<string, unknown>;
    createdAt: string;
  }>;
};

const planLabels: Record<PlanType, string> = {
  free: "Free",
  creator: "Creator",
  business: "Business",
  enterprise: "Enterprise",
  admin: "Admin",
};

const planBadgeClass: Record<PlanType, string> = {
  free: "border-gray-300/50 bg-gray-50 text-gray-700",
  creator: "border-blue-300/60 bg-blue-50 text-blue-700",
  business: "border-purple-300/60 bg-purple-50 text-purple-700",
  enterprise: "border-amber-300/60 bg-amber-50 text-amber-700",
  admin: "border-rose-300/60 bg-rose-50 text-rose-700",
};

const pageSizeOptions = [
  { value: "10", label: "10件" },
  { value: "20", label: "20件" },
  { value: "30", label: "30件" },
  { value: "50", label: "50件" },
];

function formatDate(value: string | null): string {
  if (!value) return "-";
  try {
    const date = new Date(value);
    return `${date.toLocaleString()} (${formatDistanceToNow(date, { addSuffix: true })})`;
  } catch (_err) {
    return value;
  }
}

export const AdminUserManagement: React.FC = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [planFilter, setPlanFilter] = useState<PlanType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "suspended">("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [isPlanDialogOpen, setIsPlanDialogOpen] = useState(false);
  const [targetPlan, setTargetPlan] = useState<PlanType>("free");
  const [enterpriseLimit, setEnterpriseLimit] = useState<string>("");
  const [enterprisePricing, setEnterprisePricing] = useState<string>("");
  const [enterpriseNotes, setEnterpriseNotes] = useState<string>("");
  const [planChangeReason, setPlanChangeReason] = useState("");

  const [isStatusDialogOpen, setIsStatusDialogOpen] = useState(false);
  const [statusAction, setStatusAction] = useState<"suspend" | "restore">("suspend");
  const [statusReason, setStatusReason] = useState("");

  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false);
  const [passwordResetReason, setPasswordResetReason] = useState("");
  const [lastResetLink, setLastResetLink] = useState<string | null>(null);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, planFilter, statusFilter, pageSize]);

  const listQueryKey = useMemo(
    () => [
      "admin-users",
      {
        search: debouncedSearch || null,
        plan: planFilter !== "all" ? planFilter : null,
        status: statusFilter !== "all" ? statusFilter : null,
        page,
        pageSize,
      },
    ],
    [debouncedSearch, planFilter, statusFilter, page, pageSize],
  );

  const listQuery = useQuery<ListUsersResponse>({
    queryKey: listQueryKey,
    keepPreviousData: true,
    queryFn: async ({ queryKey }) => {
      const params = queryKey[1] as {
        search: string | null;
        plan: PlanType | null;
        status: "active" | "suspended" | null;
        page: number;
        pageSize: number;
      };

      const payload: Record<string, unknown> = {
        page: params.page,
        pageSize: params.pageSize,
      };
      if (params.search) payload.search = params.search;
      if (params.plan) payload.plans = [params.plan];
      if (params.status) payload.status = params.status;

      const { data, error } = await supabase.functions.invoke("admin-list-users", {
        body: payload,
      });

      if (error) {
        console.error("admin-list-users error", error);
        throw new Error(error.message || "Failed to load users");
      }

      return data as ListUsersResponse;
    },
  });

  const detailQuery = useQuery<DetailResponse>({
    queryKey: ["admin-user-detail", selectedUserId],
    enabled: isDetailOpen && !!selectedUserId,
    queryFn: async ({ queryKey }) => {
      const userId = queryKey[1] as string;
      const { data, error } = await supabase.functions.invoke("admin-get-user-detail", {
        body: { userId },
      });
      if (error) {
        console.error("admin-get-user-detail error", error);
        throw new Error(error.message || "Failed to load user detail");
      }
      return data as DetailResponse;
    },
  });

  const planMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUserId) throw new Error("No user selected");

      const overrides =
        targetPlan === "enterprise"
          ? {
              customFanmarksLimit: enterpriseLimit ? Number(enterpriseLimit) : null,
              customPricing: enterprisePricing ? Number(enterprisePricing) : null,
              notes: enterpriseNotes || null,
            }
          : undefined;

      const { data, error } = await supabase.functions.invoke("admin-update-user-plan", {
        body: {
          userId: selectedUserId,
          newPlanType: targetPlan,
          enterpriseOverrides: overrides,
          reason: planChangeReason || null,
        },
      });

      if (error) throw new Error(error.message || "Failed to update plan");
      return data;
    },
    onSuccess: () => {
      toast({
        title: "プランを更新しました",
        description: "ユーザープランが更新されました",
      });
      queryClient.invalidateQueries({ queryKey: listQueryKey });
      queryClient.invalidateQueries({ queryKey: ["admin-user-detail", selectedUserId] });
      setIsPlanDialogOpen(false);
    },
    onError: (err: unknown) => {
      toast({
        title: "エラーが発生しました",
        description: err instanceof Error ? err.message : "プラン更新に失敗しました",
        variant: "destructive",
      });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUserId) throw new Error("No user selected");
      const { data, error } = await supabase.functions.invoke("admin-toggle-user-status", {
        body: {
          userId: selectedUserId,
          suspend: statusAction === "suspend",
          reason: statusReason || null,
        },
      });
      if (error) throw new Error(error.message || "ステータスの更新に失敗しました");
      return data;
    },
    onSuccess: (_data, _variables, _context) => {
      toast({
        title: statusAction === "suspend" ? "アカウントを停止しました" : "アカウントを再開しました",
        description: statusAction === "suspend" ? "ユーザーはログインできなくなりました" : "ユーザーが再度ログインできるようになりました",
      });
      queryClient.invalidateQueries({ queryKey: listQueryKey });
      if (selectedUserId) {
        queryClient.invalidateQueries({ queryKey: ["admin-user-detail", selectedUserId] });
      }
      setIsStatusDialogOpen(false);
    },
    onError: (err: unknown) => {
      toast({
        title: "エラーが発生しました",
        description: err instanceof Error ? err.message : "アカウントの更新に失敗しました",
        variant: "destructive",
      });
    },
  });

  const passwordMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUserId) throw new Error("No user selected");
      const { data, error } = await supabase.functions.invoke("admin-trigger-password-reset", {
        body: {
          userId: selectedUserId,
          reason: passwordResetReason || null,
        },
      });
      if (error) throw new Error(error.message || "パスワードリセットに失敗しました");
      return data as { actionLink: string };
    },
    onSuccess: (data) => {
      setLastResetLink(data.actionLink);
      toast({
        title: "リセットリンクを生成しました",
        description: "ユーザーへ共有するか、リンクを利用してリセットを完了してください",
      });
      setIsPasswordDialogOpen(false);
    },
    onError: (err: unknown) => {
      toast({
        title: "エラーが発生しました",
        description: err instanceof Error ? err.message : "リセットリンクの生成に失敗しました",
        variant: "destructive",
      });
    },
  });

  const handleSelectUser = (userId: string) => {
    setSelectedUserId(userId);
    setIsDetailOpen(true);
    setLastResetLink(null);
  };

  const selectedDetail = detailQuery.data;

  useEffect(() => {
    if (isPlanDialogOpen && selectedDetail) {
      setTargetPlan(selectedDetail.profile.planType);
      setEnterpriseLimit(
        selectedDetail.enterpriseSettings?.customFanmarksLimit != null
          ? String(selectedDetail.enterpriseSettings.customFanmarksLimit)
          : "",
      );
      setEnterprisePricing(
        selectedDetail.enterpriseSettings?.customPricing != null
          ? String(selectedDetail.enterpriseSettings.customPricing)
          : "",
      );
      setEnterpriseNotes(selectedDetail.enterpriseSettings?.notes ?? "");
      setPlanChangeReason("");
    }
  }, [isPlanDialogOpen, selectedDetail]);

  const renderStatusBadge = (user: ListedUser) => {
    const isConfirmed = !!user.emailConfirmedAt;
    const statusLabel = user.status === "active" ? "有効" : "停止中";
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={user.status === "active" ? "border-green-300/60 bg-green-50 text-green-700" : "border-red-300/60 bg-red-50 text-red-700"}>
            {statusLabel}
          </Badge>
          <Badge variant="outline" className={isConfirmed ? "border-blue-300/60 bg-blue-50 text-blue-700" : "border-amber-300/60 bg-amber-50 text-amber-700"}>
            {isConfirmed ? "確認済み" : "未確認"}
          </Badge>
        </div>
        {user.bannedUntil && user.status === "suspended" && (
          <span className="text-xs text-muted-foreground">
            {formatDate(user.bannedUntil)} まで停止
          </span>
        )}
      </div>
    );
  };

  return (
    <>
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-xl font-semibold">
            <Users2 className="h-5 w-5 text-primary" />
            ユーザー管理
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
              <div className="relative sm:w-72">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="メールアドレス、ユーザー名、表示名で検索"
                  className="pl-9"
                />
              </div>

              <Select value={planFilter} onValueChange={(value) => setPlanFilter(value as PlanType | "all")}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="プランを選択" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">すべてのプラン</SelectItem>
                  <SelectItem value="free">Free</SelectItem>
                  <SelectItem value="creator">Creator</SelectItem>
                  <SelectItem value="business">Business</SelectItem>
                  <SelectItem value="enterprise">Enterprise</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="ステータス" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">すべて</SelectItem>
                  <SelectItem value="active">有効</SelectItem>
                  <SelectItem value="suspended">停止中</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-3">
              <Select value={String(pageSize)} onValueChange={(value) => setPageSize(Number(value))}>
                <SelectTrigger className="w-28">
                  <SelectValue placeholder="件数" />
                </SelectTrigger>
                <SelectContent>
                  {pageSizeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="icon" onClick={() => listQuery.refetch()} disabled={listQuery.isFetching}>
                {listQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ユーザー</TableHead>
                  <TableHead>プラン</TableHead>
                  <TableHead>ステータス</TableHead>
                  <TableHead>最終ログイン</TableHead>
                  <TableHead className="text-right">保有ファンマ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listQuery.isLoading && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        ユーザー一覧を読み込み中です...
                      </div>
                    </TableCell>
                  </TableRow>
                )}

                {!listQuery.isLoading && listQuery.data?.data.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <div className="py-12 text-center text-muted-foreground">
                        該当するユーザーが見つかりませんでした。
                      </div>
                    </TableCell>
                  </TableRow>
                )}

                {listQuery.data?.data.map((user) => (
                  <TableRow
                    key={user.userId}
                    className="cursor-pointer transition-colors hover:bg-muted/40"
                    onClick={() => handleSelectUser(user.userId)}
                  >
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">{user.displayName || user.username}</span>
                        <span className="text-sm text-muted-foreground">{user.email ?? "メール未設定"}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={planBadgeClass[user.planType]}>
                        {planLabels[user.planType]}
                      </Badge>
                    </TableCell>
                    <TableCell>{renderStatusBadge(user)}</TableCell>
                    <TableCell>
                      <div className="flex flex-col text-sm">
                        <span>{formatDate(user.lastSignInAt)}</span>
                        <span className="text-xs text-muted-foreground">
                          登録: {formatDate(user.createdAt)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end text-sm">
                        <span className="font-medium text-foreground">
                          {user.licenseCounts.active} <span className="text-xs text-muted-foreground">（有効）</span>
                        </span>
                        <span className="text-xs text-muted-foreground">
                          猶予 {user.licenseCounts.grace} / 失効 {user.licenseCounts.expired}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {!!listQuery.data?.pagination && listQuery.data.pagination.totalPages > 0 && (
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    onClick={(event) => {
                      event.preventDefault();
                      setPage((prev) => Math.max(prev - 1, 1));
                    }}
                    aria-disabled={page <= 1}
                    className={page <= 1 ? "pointer-events-none opacity-50" : ""}
                  />
                </PaginationItem>
                <PaginationItem>
                  <PaginationLink isActive href="#">
                    {page}/{listQuery.data.pagination.totalPages || 1}
                  </PaginationLink>
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext
                    href="#"
                    onClick={(event) => {
                      event.preventDefault();
                      if (listQuery.data) {
                        setPage((prev) => Math.min(prev + 1, Math.max(listQuery.data!.pagination.totalPages, 1)));
                      }
                    }}
                    aria-disabled={page >= (listQuery.data?.pagination.totalPages ?? 1)}
                    className={page >= (listQuery.data?.pagination.totalPages ?? 1) ? "pointer-events-none opacity-50" : ""}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </CardContent>
      </Card>

      <Sheet open={isDetailOpen} onOpenChange={(open) => setIsDetailOpen(open)}>
        <SheetContent side="right" className="w-full max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>ユーザー詳細</SheetTitle>
            <SheetDescription>
              プラン変更、アカウント停止、パスワードリセットなどの操作を実行できます。
            </SheetDescription>
          </SheetHeader>

          {detailQuery.isLoading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}

          {!detailQuery.isLoading && selectedDetail && (
            <div className="space-y-6 py-6">
              <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-lg">
                    {selectedDetail.profile.displayName?.[0]?.toUpperCase() ?? "U"}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-lg font-semibold text-foreground">{selectedDetail.profile.displayName || selectedDetail.profile.username}</span>
                    <span className="text-sm text-muted-foreground">{selectedDetail.auth.email ?? "メール未設定"}</span>
                  </div>
                </div>
                <Separator className="my-4" />
                <div className="grid grid-cols-1 gap-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">プラン</span>
                    <Badge variant="outline" className={planBadgeClass[selectedDetail.profile.planType]}>
                      {planLabels[selectedDetail.profile.planType]}
                    </Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">ステータス</span>
                    <span className="font-medium text-foreground">
                      {selectedDetail.auth.status === "active" ? "有効" : "停止中"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">登録日</span>
                    <span>{formatDate(selectedDetail.profile.createdAt)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">最終ログイン</span>
                    <span>{formatDate(selectedDetail.auth.lastSignInAt)}</span>
                  </div>
                </div>
              </div>

              {selectedDetail.enterpriseSettings && (
                <Alert className="border-amber-300/60 bg-amber-50 text-amber-700">
                  <AlertDescription>
                    <div className="flex items-center gap-2 font-semibold">
                      <Crown className="h-4 w-4" />
                      Enterprise カスタム設定
                    </div>
                    <ul className="mt-2 space-y-1 text-sm">
                      <li>カスタム上限: {selectedDetail.enterpriseSettings.customFanmarksLimit ?? "未設定"}</li>
                      <li>カスタム料金: {selectedDetail.enterpriseSettings.customPricing != null ? `¥${selectedDetail.enterpriseSettings.customPricing}` : "未設定"}</li>
                      {selectedDetail.enterpriseSettings.notes && <li>メモ: {selectedDetail.enterpriseSettings.notes}</li>}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-border/50 bg-card p-4 text-center">
                  <p className="text-xs text-muted-foreground">有効</p>
                  <p className="text-2xl font-semibold text-foreground">{selectedDetail.licenseSummary.active}</p>
                </div>
                <div className="rounded-xl border border-border/50 bg-card p-4 text-center">
                  <p className="text-xs text-muted-foreground">猶予中</p>
                  <p className="text-2xl font-semibold text-foreground">{selectedDetail.licenseSummary.grace}</p>
                </div>
                <div className="rounded-xl border border-border/50 bg-card p-4 text-center">
                  <p className="text-xs text-muted-foreground">総数</p>
                  <p className="text-2xl font-semibold text-foreground">{selectedDetail.licenseSummary.total}</p>
                </div>
              </div>

              {selectedDetail.recentFanmarks.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">最近のファンマーク</h3>
                  <div className="space-y-2 text-sm">
                    {selectedDetail.recentFanmarks.map((record) => (
                      <div key={record.licenseId} className="rounded-lg border border-border/50 bg-muted/10 p-3">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-foreground">
                            {record.emoji} {record.fanmarkName ? `- ${record.fanmarkName}` : ""}
                          </span>
                          <Badge variant="outline" className="capitalize">
                            {record.status}
                          </Badge>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>ライセンス期限: {formatDate(record.licenseEnd)}</span>
                          <span>猶予期限: {record.graceExpiresAt ? formatDate(record.graceExpiresAt) : "-"}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedDetail.recentAuditLogs.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">監査ログ (最新20件)</h3>
                  <div className="space-y-2 text-xs text-muted-foreground">
                    {selectedDetail.recentAuditLogs.map((log) => (
                      <div key={log.id} className="rounded-lg border border-border/40 bg-muted/10 p-3">
                        <div className="flex justify-between">
                          <span className="font-semibold text-foreground">{log.action}</span>
                          <span>{formatDate(log.createdAt)}</span>
                        </div>
                        <div className="mt-1 break-words">
                          {JSON.stringify(log.metadata ?? {}, null, 2)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {lastResetLink && (
                <Alert className="border-blue-300/60 bg-blue-50 text-blue-700">
                  <AlertDescription>
                    パスワードリセットリンクが生成されました:
                    <Textarea
                      readOnly
                      value={lastResetLink}
                      className="mt-2 h-20 text-xs"
                    />
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          <SheetFooter className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3">
              <Button
                disabled={!selectedDetail}
                onClick={() => setIsPlanDialogOpen(true)}
                variant="outline"
                className="justify-start"
              >
                プランを変更
              </Button>
              <Button
                disabled={!selectedDetail}
                onClick={() => {
                  if (!selectedDetail) return;
                  setStatusAction(selectedDetail.auth.status === "active" ? "suspend" : "restore");
                  setStatusReason("");
                  setIsStatusDialogOpen(true);
                }}
                variant={selectedDetail?.auth.status === "active" ? "destructive" : "default"}
                className="justify-start"
              >
                {selectedDetail?.auth.status === "active" ? (
                  <>
                    <ShieldOff className="mr-2 h-4 w-4" />
                    アカウントを停止
                  </>
                ) : (
                  <>
                    <ShieldCheck className="mr-2 h-4 w-4" />
                    アカウント停止を解除
                  </>
                )}
              </Button>
              <Button
                disabled={!selectedDetail}
                onClick={() => {
                  setPasswordResetReason("");
                  setIsPasswordDialogOpen(true);
                }}
                variant="secondary"
                className="justify-start"
              >
                <KeyRound className="mr-2 h-4 w-4" />
                パスワードリセットリンクを生成
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Dialog open={isPlanDialogOpen} onOpenChange={setIsPlanDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>プランを変更</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Select value={targetPlan} onValueChange={(value) => setTargetPlan(value as PlanType)}>
              <SelectTrigger>
                <SelectValue placeholder="プランを選択" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="free">Free</SelectItem>
                <SelectItem value="creator">Creator</SelectItem>
                <SelectItem value="business">Business</SelectItem>
                <SelectItem value="enterprise">Enterprise</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>

            {targetPlan === "enterprise" && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">カスタム上限</label>
                  <Input
                    value={enterpriseLimit}
                    onChange={(event) => setEnterpriseLimit(event.target.value)}
                    placeholder="例: 250"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">カスタム料金 (JPY)</label>
                  <Input
                    value={enterprisePricing}
                    onChange={(event) => setEnterprisePricing(event.target.value)}
                    placeholder="例: 55000"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs font-medium text-muted-foreground">メモ</label>
                  <Textarea
                    value={enterpriseNotes}
                    onChange={(event) => setEnterpriseNotes(event.target.value)}
                    placeholder="エンタープライズ契約の備考"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-muted-foreground">変更理由 (任意)</label>
              <Textarea
                value={planChangeReason}
                onChange={(event) => setPlanChangeReason(event.target.value)}
                placeholder="内部共有用のメモを残せます"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setIsPlanDialogOpen(false)}>
              キャンセル
            </Button>
            <Button onClick={() => planMutation.mutate()} disabled={planMutation.isLoading}>
              {planMutation.isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              プランを更新
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={isStatusDialogOpen} onOpenChange={setIsStatusDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {statusAction === "suspend" ? "アカウントを停止します" : "アカウント停止を解除しますか？"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {statusAction === "suspend"
                ? "このユーザーはログインや API 利用ができなくなります。必要であれば理由を入力してください。"
                : "停止状態を解除し、ユーザーが再びログインできるようにします。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div>
            <Textarea
              value={statusReason}
              onChange={(event) => setStatusReason(event.target.value)}
              placeholder="内部向けのメモ / 理由 (任意)"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => statusMutation.mutate()}
              disabled={statusMutation.isLoading}
              className={statusAction === "suspend" ? "bg-destructive hover:bg-destructive/90" : ""}
            >
              {statusMutation.isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {statusAction === "suspend" ? "停止する" : "停止を解除する"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isPasswordDialogOpen} onOpenChange={setIsPasswordDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>パスワードリセットリンクを生成</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              リンクは即時に生成され、メール送信は行われません。リンクをコピーしてユーザーに共有してください。
            </p>
            <Textarea
              value={passwordResetReason}
              onChange={(event) => setPasswordResetReason(event.target.value)}
              placeholder="内部共有用のメモを残せます (任意)"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setIsPasswordDialogOpen(false)}>
              キャンセル
            </Button>
            <Button onClick={() => passwordMutation.mutate()} disabled={passwordMutation.isLoading}>
              {passwordMutation.isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              リンクを生成
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default AdminUserManagement;
