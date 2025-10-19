import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Loader2, Plus, RefreshCw, ToggleLeft, ToggleRight, Trash2, Pencil } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { useInvitationAdmin, InvitationCodeFormValues } from '@/hooks/useInvitationAdmin';
import { SecureWaitlistAdmin } from '@/components/SecureWaitlistAdmin';
import { useTranslation } from '@/hooks/useTranslation';

interface InvitationFormState extends InvitationCodeFormValues {
  id?: string;
}

export const AdminInvitationManager = () => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { settings, updateSetting } = useSystemSettings();
  const { codes, loading, error, refresh, createCode, updateCode, toggleActive, deleteCode } = useInvitationAdmin();
  const [createOpen, setCreateOpen] = useState(false);
  const [editState, setEditState] = useState<InvitationFormState | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const invitationModeEnabled = settings.invitation_mode;

  const sortedCodes = useMemo(
    () =>
      [...codes].sort((a, b) => {
        if (a.is_active === b.is_active) return a.created_at > b.created_at ? -1 : 1;
        return a.is_active ? -1 : 1;
      }),
    [codes]
  );

  const handleToggleMode = async (value: boolean) => {
    const result = await updateSetting('invitation_mode', value);
    toast({
      title: result ? t('admin.invitation.modeToggleSuccess') : t('admin.invitation.modeToggleError'),
      variant: result ? 'default' : 'destructive',
    });
  };

  const handleCreate = async (values: InvitationCodeFormValues) => {
    setSubmitting(true);
    const result = await createCode(values);
    setSubmitting(false);
    if (result.success) {
      toast({ title: t('admin.invitation.createSuccess'), description: `${t('admin.invitation.createdCodePrefix')} ${result.code}` });
      setCreateOpen(false);
    } else {
      toast({ title: t('admin.invitation.createError'), description: result.error instanceof Error ? result.error.message : '', variant: 'destructive' });
    }
  };

  const handleEdit = async (id: string, values: InvitationCodeFormValues) => {
    setSubmitting(true);
    const payload: Record<string, unknown> = {
      max_uses: values.maxUses,
      expires_at: values.expiresAt || null,
      special_perks: values.specialPerks ?? null,
    };
    const result = await updateCode(id, payload);
    setSubmitting(false);
    if (result.success) {
      toast({ title: t('admin.invitation.updateSuccess') });
      setEditState(null);
    } else {
      toast({ title: t('admin.invitation.updateError'), description: result.error instanceof Error ? result.error.message : '', variant: 'destructive' });
    }
  };

  const handleToggleActive = async (id: string, active: boolean) => {
    const result = await toggleActive(id, active);
    toast({
      title: result.success ? t('admin.invitation.toggleSuccess') : t('admin.invitation.toggleError'),
      variant: result.success ? 'default' : 'destructive',
    });
  };

  const handleDelete = async (id: string) => {
    const result = await deleteCode(id);
    toast({
      title: result.success ? t('admin.invitation.deleteSuccess') : t('admin.invitation.deleteError'),
      variant: result.success ? 'default' : 'destructive',
    });
  };

  return (
    <div className="space-y-6">
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="space-y-3 p-6 pb-4 sm:flex sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
          <div>
            <CardTitle>{t('admin.invitation.modeTitle')}</CardTitle>
            <CardDescription>{t('admin.invitation.modeDescription')}</CardDescription>
          </div>
          <div className="flex items-center gap-3 rounded-full border border-primary/20 bg-background px-4 py-2">
            <span className="text-sm font-medium text-muted-foreground">{t('admin.invitation.modeLabel')}</span>
            <Switch checked={invitationModeEnabled} onCheckedChange={handleToggleMode} />
          </div>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4 px-6 pb-6 pt-0 text-sm text-muted-foreground">
          <div>{invitationModeEnabled ? t('admin.invitation.modeOn') : t('admin.invitation.modeOff')}</div>
          <Button variant="outline" size="sm" className="gap-2 rounded-full border-primary/20" onClick={() => refresh()}>
            <RefreshCw className="h-4 w-4" />
            {t('admin.invitation.reload')}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border/60 shadow-sm">
        <CardHeader className="space-y-3 p-6 pb-4 sm:flex sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
          <div>
            <CardTitle>{t('admin.invitation.codesTitle')}</CardTitle>
            <CardDescription>{t('admin.invitation.codesDescription')}</CardDescription>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                {t('admin.invitation.createButton')}
              </Button>
            </DialogTrigger>
            <InvitationCodeDialog
              title={t('admin.invitation.createTitle')}
              description={t('admin.invitation.createDescription')}
              loading={submitting}
              onSubmit={handleCreate}
              onClose={() => setCreateOpen(false)}
            />
          </Dialog>
        </CardHeader>
        <CardContent className="space-y-4 p-6 pt-0">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              {t('admin.invitation.table.loading')}
            </div>
          ) : error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-6 text-center text-sm text-destructive">
              {t('admin.invitation.table.error')}
            </div>
          ) : sortedCodes.length === 0 ? (
            <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-6 text-center text-sm text-muted-foreground">
              {t('admin.invitation.table.empty')}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-primary/15">
              <Table>
                <TableHeader className="bg-muted/60">
                  <TableRow>
                    <TableHead className="w-[140px]">{t('admin.invitation.table.code')}</TableHead>
                    <TableHead>{t('admin.invitation.table.status')}</TableHead>
                    <TableHead>{t('admin.invitation.table.usage')}</TableHead>
                    <TableHead>{t('admin.invitation.table.expires')}</TableHead>
                    <TableHead>{t('admin.invitation.table.perks')}</TableHead>
                    <TableHead className="w-[150px] text-right">{t('admin.invitation.table.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedCodes.map((code) => (
                    <TableRow key={code.id} className="text-sm">
                      <TableCell className="font-mono text-sm font-semibold">{code.code}</TableCell>
                      <TableCell>
                        <Badge variant={code.is_active ? 'default' : 'secondary'} className="rounded-full px-2 py-0.5">
                          {code.is_active ? t('admin.invitation.statusActive') : t('admin.invitation.statusInactive')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {code.used_count} / {code.max_uses}
                      </TableCell>
                      <TableCell>
                        {code.expires_at ? format(new Date(code.expires_at), 'yyyy/MM/dd HH:mm') : t('admin.invitation.noExpiry')}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {code.special_perks ? JSON.stringify(code.special_perks) : '-'}
                      </TableCell>
                      <TableCell className="flex items-center justify-end gap-2">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() =>
                            handleToggleActive(code.id, !code.is_active)
                          }
                          title={code.is_active ? t('admin.invitation.deactivate') : t('admin.invitation.activate')}
                        >
                          {code.is_active ? <ToggleRight className="h-4 w-4 text-primary" /> : <ToggleLeft className="h-4 w-4 text-muted-foreground" />}
                        </Button>
                        <Dialog open={editState?.id === code.id} onOpenChange={(open) => setEditState(open ? mapCodeToForm(code) : null)}>
                          <DialogTrigger asChild>
                            <Button size="icon" variant="ghost">
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </DialogTrigger>
                          {editState?.id === code.id && (
                            <InvitationCodeDialog
                              title={t('admin.invitation.editTitle')}
                              description={t('admin.invitation.editDescription')}
                              defaults={editState}
                              loading={submitting}
                              onSubmit={(values) => handleEdit(code.id, values)}
                              onClose={() => setEditState(null)}
                            />
                          )}
                        </Dialog>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="icon" variant="ghost">
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t('admin.invitation.deleteConfirmTitle')}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {t('admin.invitation.deleteConfirmDesc', { code: code.code })}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(code.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                {t('common.delete')}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/60 shadow-sm">
        <CardHeader className="space-y-2 p-6 pb-4">
          <CardTitle>{t('admin.invitation.waitlistTitle')}</CardTitle>
          <CardDescription>{t('admin.invitation.waitlistDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 p-6 pt-0">
          <Separator />
          <SecureWaitlistAdmin />
        </CardContent>
      </Card>
    </div>
  );
};

interface InvitationCodeDialogProps {
  title: string;
  description: string;
  defaults?: InvitationFormState;
  loading: boolean;
  onSubmit: (values: InvitationCodeFormValues) => Promise<void>;
  onClose: () => void;
}

const InvitationCodeDialog = ({ title, description, defaults, loading, onSubmit, onClose }: InvitationCodeDialogProps) => {
  const { t } = useTranslation();
  const [code, setCode] = useState(defaults?.code ?? '');
  const [maxUses, setMaxUses] = useState(defaults?.maxUses.toString() ?? '10');
  const [expiresAt, setExpiresAt] = useState(defaults?.expiresAt ?? '');
  const [perks, setPerks] = useState(defaults?.specialPerks ? JSON.stringify(defaults.specialPerks, null, 2) : '');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    if (Number.isNaN(Number(maxUses)) || Number(maxUses) <= 0) {
      setError(t('admin.invitation.dialog.maxUsesError'));
      return;
    }

    let parsedPerks: Record<string, unknown> | null = null;
    if (perks.trim()) {
      try {
        parsedPerks = JSON.parse(perks);
      } catch {
        setError(t('admin.invitation.dialog.jsonError'));
        return;
      }
    }

    await onSubmit({
      code: code.trim() || undefined,
      maxUses: Number(maxUses),
      expiresAt: expiresAt || undefined,
      specialPerks: parsedPerks,
    });
  };

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="invitation-code">{t('admin.invitation.dialog.codeLabel')}</Label>
          <Input
            id="invitation-code"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="例: INVITE2025"
            maxLength={12}
          />
          <p className="text-xs text-muted-foreground">{t('admin.invitation.dialog.codeHelp')}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="invitation-max-uses">{t('admin.invitation.dialog.maxUsesLabel')}</Label>
          <Input
            id="invitation-max-uses"
            type="number"
            min={1}
            value={maxUses}
            onChange={(event) => setMaxUses(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="invitation-expires-at">{t('admin.invitation.dialog.expiresLabel')}</Label>
          <Input
            id="invitation-expires-at"
            type="datetime-local"
            value={expiresAt ? toLocalInputValue(expiresAt) : ''}
            onChange={(event) => setExpiresAt(event.target.value ? new Date(event.target.value).toISOString() : '')}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="invitation-perks">{t('admin.invitation.dialog.perksLabel')}</Label>
          <Textarea
            id="invitation-perks"
            value={perks}
            onChange={(event) => setPerks(event.target.value)}
            placeholder='例: { "bonus_emojis": 5 }'
            className="min-h-[120px]"
          />
        </div>
        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
      </div>
      <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onClose} disabled={loading} className="rounded-full">
          {t('admin.invitation.dialog.cancel')}
        </Button>
        <Button onClick={handleSubmit} disabled={loading} className="rounded-full">
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t('admin.invitation.dialog.save')}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
};

const mapCodeToForm = (code: InvitationCodeRow): InvitationFormState => ({
  id: code.id,
  code: code.code,
  maxUses: code.max_uses,
  expiresAt: code.expires_at ?? undefined,
  specialPerks: code.special_perks as Record<string, unknown> | null,
});

function toLocalInputValue(isoString: string) {
  try {
    const date = new Date(isoString);
    const tzOffset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - tzOffset).toISOString().slice(0, 16);
  } catch {
    return '';
  }
}
