import { Badge } from '@/components/ui/badge';
import type { useTranslation } from '@/hooks/useTranslation';
import type { LicenseTimingResult } from '@/lib/licenseTiming';
import { navigateToFanmark } from '@/utils/emojiUrl';
import { ExternalLink } from 'lucide-react';
import { FiCheckCircle, FiFileText, FiLink, FiMoon, FiTarget, FiUser } from 'react-icons/fi';

export function createDashboardPresentation(t: ReturnType<typeof useTranslation>['t']) {
  const getStatusBadge = (timing: LicenseTimingResult) => {
    let icon = <FiMoon className="h-3.5 w-3.5" />;
    let className = 'border-gray-200/60 bg-gray-50 text-gray-600 shadow-sm';
    let label = t('dashboard.statusUnknown');

    switch (timing.status) {
      case 'active':
        icon = <FiCheckCircle className="h-3.5 w-3.5" />;
        className = 'border-emerald-200/60 bg-emerald-50 text-emerald-600 shadow-sm';
        label = t('dashboard.statusActive');
        break;
      case 'grace-return':
        icon = <FiTarget className="h-3.5 w-3.5" />;
        className = 'border-amber-200/60 bg-amber-50 text-amber-600 shadow-sm';
        label = t('dashboard.statusReturnProcessing');
        break;
      case 'grace':
        icon = <FiTarget className="h-3.5 w-3.5" />;
        className = 'border-amber-200/60 bg-amber-50 text-amber-600 shadow-sm';
        label = t('dashboard.statusGrace');
        break;
      case 'expired':
      default:
        icon = <FiTarget className="h-3.5 w-3.5" />;
        className = 'border-rose-200/60 bg-rose-50 text-rose-600 shadow-sm';
        label = t('dashboard.statusExpired');
        break;
    }

    return (
      <Badge className={`${className} inline-flex items-center gap-1 sm:gap-1.5 rounded-full border px-2 sm:px-3 py-0.5 sm:py-1 text-[10px] sm:text-xs font-semibold tracking-wide whitespace-nowrap`}>
        {icon}
        <span>{label}</span>
      </Badge>
    );
  };

  const getTierOvalStyle = (tierLevel: number): string => {
    switch (tierLevel) {
      case 4: // S Tier - Gold/Platinum
        return "bg-gradient-to-br from-amber-200 via-yellow-100 to-amber-300 border-[3px] border-amber-500 shadow-lg hover:shadow-xl transition-all duration-300 tier-s-shine";
      case 3: // A Tier - Purple/Violet
        return "bg-gradient-to-br from-purple-200 via-violet-200 to-purple-300 border-[2.5px] border-purple-500 shadow-md hover:shadow-lg transition-all duration-300 tier-a-glow";
      case 2: // B Tier - Blue/Cyan
        return "bg-gradient-to-br from-blue-100 via-cyan-100 to-blue-200 border-2 border-blue-400 shadow-sm hover:shadow-md transition-all duration-300";
      case 1: // C Tier - Green/White
        return "bg-gradient-to-br from-emerald-50 via-white to-emerald-100 border border-emerald-300 shadow-sm hover:shadow transition-all duration-300";
      default:
        return "bg-gradient-to-br from-gray-50 to-gray-100 border border-gray-200";
    }
  };

  const getTierBadgeStyle = (tierLevel: number): string => {
    switch (tierLevel) {
      case 4: // S Tier - Gold gradient
        return "bg-gradient-to-br from-amber-500 to-yellow-600 text-white border border-amber-600";
      case 3: // A Tier - Purple gradient
        return "bg-gradient-to-br from-purple-500 to-violet-600 text-white border border-purple-600";
      case 2: // B Tier - Blue gradient
        return "bg-gradient-to-br from-blue-500 to-cyan-600 text-white border border-blue-600";
      case 1: // C Tier - Green gradient
        return "bg-gradient-to-br from-emerald-500 to-green-600 text-white border border-emerald-600";
      default:
        return "bg-foreground text-background";
    }
  };

  const getTierLabel = (tierLevel: number | null | undefined) => {
    switch (tierLevel) {
      case 1:
        return 'C';
      case 2:
        return 'B';
      case 3:
        return 'A';
      case 4:
        return 'S';
      default:
        return '—';
    }
  };

  const getAccessTypeBadge = (accessType: string, fanmarkEmoji?: string) => {
    let IconComponent = FiMoon;
    let label = t('dashboard.accessTypes.inactive');

    if (accessType === 'profile') {
      IconComponent = FiUser;
      label = t('dashboard.accessTypes.profile');
    } else if (accessType === 'redirect') {
      IconComponent = FiLink;
      label = t('dashboard.accessTypes.redirect');
    } else if (accessType === 'text') {
      IconComponent = FiFileText;
      label = t('dashboard.accessTypes.text');
    }

    const handleClick = fanmarkEmoji ? (e: React.MouseEvent) => {
      e.stopPropagation();
      navigateToFanmark(fanmarkEmoji, true);
    } : undefined;

    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-foreground">
        <IconComponent className="h-3 w-3 text-foreground" aria-hidden="true" />
        <span>{label}</span>
        {fanmarkEmoji && accessType !== 'inactive' && (
          <button
            type="button"
            onClick={handleClick}
            className="ml-0.5 p-0.5 rounded hover:bg-primary/10 hover:text-primary transition-colors"
            aria-label={t('dashboard.visitFanmarkTooltip')}
          >
            <ExternalLink className="h-3 w-3" />
          </button>
        )}
      </span>
    );
  };

  return { getStatusBadge, getTierOvalStyle, getTierBadgeStyle, getTierLabel, getAccessTypeBadge };
}
