import React, { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { Badge } from "@/components/ui/badge";
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { Loader2, Upload, Plus, Pencil, Trash2, RefreshCcw, Search } from "lucide-react";

type EmojiMasterRecord = {
  id: string;
  emoji: string;
  short_name: string;
  keywords: string[];
  category: string | null;
  subcategory: string | null;
  codepoints: string[];
  sort_order: number | null;
  updated_at: string;
};

type EmojiFormState = {
  emoji: string;
  short_name: string;
  keywords: string;
  category: string;
  subcategory: string;
  codepoints: string;
  sort_order: string;
};

const EMPTY_FORM: EmojiFormState = {
  emoji: "",
  short_name: "",
  keywords: "",
  category: "",
  subcategory: "",
  codepoints: "",
  sort_order: "",
};

const PAGE_SIZE_OPTIONS = [25, 50, 100];

function sanitizeSearchTerm(value: string) {
  return value.replace(/[,]/g, " ").trim();
}

async function fetchEmojiMaster(params: { page: number; pageSize: number; search: string }) {
  const { page, pageSize, search } = params;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("emoji_master")
    .select("*", { count: "exact" })
    .order("sort_order", { ascending: true, nullsFirst: true })
    .order("emoji", { ascending: true })
    .range(from, to);

  if (search) {
    const sanitized = sanitizeSearchTerm(search);
    query = query.or(`short_name.ilike.%${sanitized}%,emoji.ilike.%${sanitized}%`);
  }

  const { data, error, count } = await query;
  if (error) {
    throw new Error(error.message || "Failed to load emoji master");
  }

  return {
    items: (data ?? []) as EmojiMasterRecord[],
    total: count ?? 0,
  };
}

function parseKeywords(input: string): string[] {
  return input
    .split(/[,\s]+/)
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean);
}

function parseCodepoints(input: string): string[] {
  return input
    .split(/[,\s]+/)
    .map((cp) => cp.trim().toUpperCase())
    .filter(Boolean);
}

function toFormState(record: EmojiMasterRecord): EmojiFormState {
  return {
    emoji: record.emoji,
    short_name: record.short_name,
    keywords: record.keywords.join(", "),
    category: record.category ?? "",
    subcategory: record.subcategory ?? "",
    codepoints: record.codepoints.join(" "),
    sort_order: record.sort_order != null ? String(record.sort_order) : "",
  };
}

type ImportRecord = {
  emoji: string;
  short_name: string;
  keywords?: string[];
  category?: string | null;
  subcategory?: string | null;
  codepoints: string[];
  sort_order?: number | null;
};

async function upsertEmoji(record: EmojiFormState, id?: string) {
  const payload = {
    emoji: record.emoji,
    short_name: record.short_name,
    keywords: parseKeywords(record.keywords),
    category: record.category || null,
    subcategory: record.subcategory || null,
    codepoints: parseCodepoints(record.codepoints),
    sort_order: record.sort_order ? Number(record.sort_order) : null,
  };

  if (id) {
    const { error } = await supabase.from("emoji_master").update(payload).eq("id", id);
    if (error) throw new Error(error.message);
    return id;
  } else {
    const { data, error } = await supabase.from("emoji_master").insert(payload).select("id").single();
    if (error) throw new Error(error.message);
    return data?.id as string;
  }
}

async function deleteEmoji(id: string) {
  const { error } = await supabase.from("emoji_master").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

async function importEmojiRecords(records: ImportRecord[]) {
  const prepared = records.map((record) => ({
    emoji: record.emoji,
    short_name: record.short_name,
    keywords: record.keywords ?? [],
    category: record.category ?? null,
    subcategory: record.subcategory ?? null,
    codepoints: record.codepoints,
    sort_order: record.sort_order ?? null,
  }));

  const chunks = chunkArray(prepared, 500);
  for (const chunk of chunks) {
    const { error } = await supabase.from("emoji_master").upsert(chunk, { onConflict: "emoji" });
    if (error) {
      throw new Error(error.message);
    }
  }
}

function parseJsonImport(text: string): ImportRecord[] {
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error("JSON ファイルは配列形式にしてください。");
  }

  return parsed.map((item) => {
    if (!item.emoji || !item.short_name || !item.codepoints) {
      throw new Error("emoji / short_name / codepoints は必須です。");
    }

    return {
      emoji: item.emoji,
      short_name: item.short_name,
      keywords: item.keywords ?? [],
      category: item.category ?? null,
      subcategory: item.subcategory ?? null,
      codepoints: Array.isArray(item.codepoints)
        ? item.codepoints
        : String(item.codepoints)
            .split(/[,\s]+/)
            .map((cp: string) => cp.toUpperCase())
            .filter(Boolean),
      sort_order: item.sort_order ?? null,
    };
  });
}

function parseCsvImport(text: string): ImportRecord[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [];
  }

  const headers = lines[0].split(",").map((header) => header.trim().toLowerCase());
  const requiredColumns = ["emoji", "short_name", "codepoints"];
  for (const column of requiredColumns) {
    if (!headers.includes(column)) {
      throw new Error(`CSV に ${column} カラムが必要です。`);
    }
  }

  const records: ImportRecord[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const values = lines[i].split(",").map((value) => value.trim());
    if (values.length === 0) continue;

    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });

    const emoji = row.emoji;
    const shortName = row.short_name;
    const codepoints = parseCodepoints(row.codepoints);

    if (!emoji || !shortName || codepoints.length === 0) {
      continue;
    }

    records.push({
      emoji,
      short_name: shortName,
      keywords: row.keywords ? parseKeywords(row.keywords) : [],
      category: row.category || null,
      subcategory: row.subcategory || null,
      codepoints,
      sort_order: row.sort_order ? Number(row.sort_order) : null,
    });
  }

  return records;
}

function getImportRecords(text: string, fileName: string): ImportRecord[] {
  if (fileName.toLowerCase().endsWith(".json")) {
    return parseJsonImport(text);
  }
  return parseCsvImport(text);
}

export const AdminEmojiMaster: React.FC = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<EmojiMasterRecord | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formState, setFormState] = useState<EmojiFormState>(EMPTY_FORM);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const queryKey = useMemo(
    () => ["emoji-master-list", { page, pageSize, search }],
    [page, pageSize, search],
  );

  const listQuery = useQuery({
    queryKey,
    placeholderData: (previousData) => previousData,
    queryFn: () => fetchEmojiMaster({ page, pageSize, search }),
  });

  const upsertMutation = useMutation({
    mutationFn: async () => {
      await upsertEmoji(formState, selected?.id);
    },
    onSuccess: () => {
      toast({ title: "保存しました", description: "絵文字マスタが更新されました。" });
      queryClient.invalidateQueries({ queryKey });
      setIsFormOpen(false);
      setSelected(null);
      setFormState(EMPTY_FORM);
    },
    onError: (error: unknown) => {
      toast({
        title: "保存に失敗しました",
        description: error instanceof Error ? error.message : "不明なエラーです。",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!selected?.id) return;
      await deleteEmoji(selected.id);
    },
    onSuccess: () => {
      toast({ title: "削除しました", description: "絵文字マスタから削除されました。" });
      queryClient.invalidateQueries({ queryKey });
      setIsDeleteOpen(false);
      setSelected(null);
    },
    onError: (error: unknown) => {
      toast({
        title: "削除に失敗しました",
        description: error instanceof Error ? error.message : "不明なエラーです。",
        variant: "destructive",
      });
    },
  });

  const handleEdit = (record: EmojiMasterRecord) => {
    setSelected(record);
    setFormState(toFormState(record));
    setIsFormOpen(true);
  };

  const handleAdd = () => {
    setSelected(null);
    setFormState(EMPTY_FORM);
    setIsFormOpen(true);
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    try {
      const text = await file.text();
      const records = getImportRecords(text, file.name);
      if (records.length === 0) {
        toast({ title: "インポート対象なし", description: "ファイルに有効なデータが見つかりませんでした。" });
        return;
      }
      await importEmojiRecords(records);
      toast({ title: "インポート完了", description: `${records.length} 件の絵文字を取り込みました。` });
      queryClient.invalidateQueries({ queryKey });
    } catch (error) {
      toast({
        title: "インポートに失敗しました",
        description: error instanceof Error ? error.message : "不明なエラーです。",
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
      event.target.value = "";
    }
  };

  const totalPages = useMemo(() => {
    if (!listQuery.data?.total) return 1;
    return Math.max(1, Math.ceil(listQuery.data.total / pageSize));
  }, [listQuery.data, pageSize]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="絵文字・ショートネームで検索"
              className="pl-9"
              value={search}
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
            />
          </div>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => {
              setPageSize(Number(value));
              setPage(1);
            }}
          >
            <SelectTrigger className="w-28">
              <SelectValue placeholder="件数" />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {option}件
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => listQuery.refetch()} disabled={listQuery.isFetching}>
            {listQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
          </Button>
          <Button variant="outline" asChild disabled={isImporting}>
            <label className="flex cursor-pointer items-center gap-2">
              {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              インポート
              <input type="file" accept=".csv,.json,.txt" className="hidden" onChange={handleImport} />
            </label>
          </Button>
          <Button onClick={handleAdd}>
            <Plus className="mr-2 h-4 w-4" />
            追加
          </Button>
        </div>
      </div>

      <Card className="border-border/60 shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20 text-center">絵文字</TableHead>
                <TableHead>ショートネーム</TableHead>
                <TableHead>カテゴリ</TableHead>
                <TableHead>キーワード</TableHead>
                <TableHead className="w-32 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listQuery.isLoading && (
                <TableRow>
                  <TableCell colSpan={5}>
                    <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      読み込み中です…
                    </div>
                  </TableCell>
                </TableRow>
              )}

              {!listQuery.isLoading && listQuery.data?.items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5}>
                    <div className="py-12 text-center text-muted-foreground">絵文字マスタが登録されていません。</div>
                  </TableCell>
                </TableRow>
              )}

              {listQuery.data?.items.map((record) => (
                <TableRow key={record.id}>
                  <TableCell className="text-center text-2xl">{record.emoji}</TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">{record.short_name}</span>
                      <span className="text-xs text-muted-foreground">
                        {record.codepoints.join(" ")}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col text-sm">
                      <span>{record.category ?? "-"}</span>
                      <span className="text-muted-foreground">{record.subcategory ?? ""}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {record.keywords.map((keyword) => (
                        <Badge key={keyword} variant="outline" className="text-xs">
                          {keyword}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="icon" onClick={() => handleEdit(record)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive"
                        onClick={() => {
                          setSelected(record);
                          setIsDeleteOpen(true);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              href="#"
              aria-disabled={page <= 1}
              className={page <= 1 ? "pointer-events-none opacity-50" : ""}
              onClick={(event) => {
                event.preventDefault();
                if (page > 1) setPage((prev) => prev - 1);
              }}
            />
          </PaginationItem>
          <PaginationItem>
            <PaginationLink isActive href="#">
              {page} / {totalPages}
            </PaginationLink>
          </PaginationItem>
          <PaginationItem>
            <PaginationNext
              href="#"
              aria-disabled={page >= totalPages}
              className={page >= totalPages ? "pointer-events-none opacity-50" : ""}
              onClick={(event) => {
                event.preventDefault();
                if (page < totalPages) setPage((prev) => prev + 1);
              }}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>

      <Dialog open={isFormOpen} onOpenChange={(open) => {
        setIsFormOpen(open);
        if (!open) {
          setSelected(null);
          setFormState(EMPTY_FORM);
        }
      }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{selected ? "絵文字を編集" : "絵文字を追加"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <label className="text-sm font-medium text-muted-foreground">絵文字 (必須)</label>
              <Input
                value={formState.emoji}
                onChange={(event) => setFormState((prev) => ({ ...prev, emoji: event.target.value }))}
                maxLength={8}
                placeholder="😊"
              />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium text-muted-foreground">ショートネーム (必須)</label>
              <Input
                value={formState.short_name}
                onChange={(event) => setFormState((prev) => ({ ...prev, short_name: event.target.value }))}
                placeholder="smiling_face_with_smiling_eyes"
              />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium text-muted-foreground">キーワード (カンマ / 空白区切り)</label>
              <Input
                value={formState.keywords}
                onChange={(event) => setFormState((prev) => ({ ...prev, keywords: event.target.value }))}
                placeholder="happy smile"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <label className="text-sm font-medium text-muted-foreground">カテゴリ</label>
                <Input
                  value={formState.category}
                  onChange={(event) => setFormState((prev) => ({ ...prev, category: event.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium text-muted-foreground">サブカテゴリ</label>
                <Input
                  value={formState.subcategory}
                  onChange={(event) => setFormState((prev) => ({ ...prev, subcategory: event.target.value }))}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium text-muted-foreground">コードポイント (スペース区切り, 例: 1F60A)</label>
              <Input
                value={formState.codepoints}
                onChange={(event) => setFormState((prev) => ({ ...prev, codepoints: event.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium text-muted-foreground">表示順 (任意)</label>
              <Input
                type="number"
                value={formState.sort_order}
                onChange={(event) => setFormState((prev) => ({ ...prev, sort_order: event.target.value }))}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setIsFormOpen(false)}>
              キャンセル
            </Button>
            <Button
              onClick={() => upsertMutation.mutate()}
              disabled={
                upsertMutation.isPending ||
                !formState.emoji ||
                !formState.short_name ||
                parseCodepoints(formState.codepoints).length === 0
              }
            >
              {upsertMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>絵文字を削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              この操作は取り消せません。関連機能がこの絵文字を参照していないか確認してください。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              削除する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-4 text-xs text-muted-foreground">
        <p className="font-semibold text-foreground">インポート形式について</p>
        <p className="mt-2">
          JSON: <code>[&#123; emoji, short_name, keywords, category, subcategory, codepoints, sort_order &#125;]</code> の配列形式にしてください。
        </p>
        <p className="mt-1">
          CSV: <code>emoji,short_name,codepoints,keywords,category,subcategory,sort_order</code> のヘッダーで、コードポイントはスペース区切りで指定します。
        </p>
      </div>
    </div>
  );
};

export default AdminEmojiMaster;
