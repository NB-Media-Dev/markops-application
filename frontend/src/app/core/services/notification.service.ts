import { Injectable, signal, computed, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { io, Socket } from 'socket.io-client';
import { AuthService } from './auth.service';
import { safeFetch, getBackendBaseUrl } from '../utils/api-url.utils';

export interface NotificationItem {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: 'INFO' | 'SUCCESS' | 'WARNING' | 'ALERT';
  isRead: boolean;
  createdAt: string;
  targetRoute?: string;
  link?: string;
}

export function cleanNotificationText(str: string | undefined | null): string {
  if (!str) return '';
  return str
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2300}-\u{23FF}\u{2B50}\u{200D}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizeNotification(item: NotificationItem): NotificationItem {
  return {
    ...item,
    title: cleanNotificationText(item.title),
    message: cleanNotificationText(item.message),
  };
}

export function isNotificationAllowedForRole(item: NotificationItem, role?: string): boolean {
  if (!role) return true;
  const roleUpper = role.toUpperCase().trim();
  const t = (item.title || '').toLowerCase();
  const m = (item.message || '').toLowerCase();
  const target = (item.targetRoute || '').toLowerCase();

  if (roleUpper === 'DESIGNER') {
    // Designer should ONLY see tasks assigned to them and design status updates
    if (
      t.includes('lead') ||
      m.includes('lead') ||
      t.includes('telecall') ||
      m.includes('telecall') ||
      t.includes('call logged') ||
      m.includes('call logged') ||
      t.includes('interested') ||
      m.includes('interested') ||
      t.includes('qualified') ||
      m.includes('qualified') ||
      t.includes('campaign') ||
      m.includes('campaign') ||
      t.includes('target') ||
      m.includes('target') ||
      target.includes('/leads') ||
      target.includes('/telecalling') ||
      target.includes('/targets') ||
      target.includes('dept=telecalling')
    ) {
      return false;
    }
  }

  if (roleUpper === 'TELECALLER') {
    if (
      t.includes('task approved') ||
      t.includes('design uploaded') ||
      t.includes('redesign') ||
      t.includes('submission') ||
      t.includes('creative design') ||
      t.includes('creative brief') ||
      target.includes('/designer-tasks') ||
      target.includes('/submissions') ||
      target.includes('/revisions') ||
      target.includes('dept=designer')
    ) {
      return false;
    }
  }

  return true;
}

export const TELECALLING_PACKAGE_TARGET_ROUTE =
  '/package-works?package=CAREERMATE&workspace=CURRENT-AFFAIR-PACKAGE&dept=TELECALLING&tab=TELECALLER_MEMBERS';

@Injectable({
  providedIn: 'root',
})
export class NotificationService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private socket: Socket | null = null;

  readonly notifications = signal<NotificationItem[]>([]);
  readonly activeToast = signal<NotificationItem | null>(null);
  readonly unreadCount = computed(() => this.notifications().filter((n) => !n.isRead).length);

  constructor() {
    if (this.isBrowser) {
      this.loadNotifications();
      this.initRealtimeSocket();
    }
  }

  private initRealtimeSocket(): void {
    try {
      const backendUrl = getBackendBaseUrl();
      this.socket = io(backendUrl, {
        transports: ['polling', 'websocket'],
        reconnectionAttempts: 5,
        timeout: 10000,
      });

      this.socket.on('connect_error', () => {

      });

      this.socket.on('notification:created', (rawNotif: NotificationItem) => {
        const notif = sanitizeNotification(rawNotif);
        const currentUser = this.authService.currentUser();
        if (!currentUser) return;

        const currentUserId = currentUser.id;
        const currentUserEmail = currentUser.email;
        const currentUserFullName = currentUser.fullName;
        const currentUserRole = currentUser.role;

        // Role-based authorization gate (Designer ONLY sees task notifications)
        if (!isNotificationAllowedForRole(notif, currentUserRole)) {
          return;
        }

        const targetUserIdStr = String(notif.userId || '').trim().toLowerCase();
        const uIdStr = String(currentUserId || '').trim().toLowerCase();
        const uEmailStr = String(currentUserEmail || '').trim().toLowerCase();
        const uNameStr = String(currentUserFullName || '').trim().toLowerCase();

        if (!targetUserIdStr) return;

        // Check explicit match strictly for this user (Creator or Assignee)
        let matchesUser =
          (uIdStr && targetUserIdStr === uIdStr) ||
          (uEmailStr && targetUserIdStr === uEmailStr) ||
          (uNameStr && targetUserIdStr === uNameStr);

        // Fallback for standard seed accounts
        if (!matchesUser) {
          if (uIdStr === '1' || uIdStr === 'usr_admin_01') {
            matchesUser = targetUserIdStr === '1' || targetUserIdStr === 'usr_admin_01';
          } else if (uIdStr === '2' || uIdStr === 'usr_bdm_01') {
            matchesUser = targetUserIdStr === '2' || targetUserIdStr === 'usr_bdm_01';
          } else if (uIdStr === '3' || uIdStr === 'usr_mktg_01') {
            matchesUser = targetUserIdStr === '3' || targetUserIdStr === 'usr_mktg_01';
          } else if (uIdStr === '4' || uIdStr === 'usr_digital_01') {
            matchesUser = targetUserIdStr === '4' || targetUserIdStr === 'usr_digital_01';
          } else if (uIdStr === '5' || uIdStr === 'usr_designer_01') {
            matchesUser = targetUserIdStr === '5' || targetUserIdStr === 'usr_designer_01';
          } else if (uIdStr === '6' || uIdStr === 'usr_telecaller_01') {
            matchesUser = targetUserIdStr === '6' || targetUserIdStr === 'usr_telecaller_01';
          }
        }

        if (matchesUser) {
          const m = String(notif.message || '').toLowerCase();
          const t = String(notif.title || '').toLowerCase();
          if (t.includes('30 leads') || m.includes('total leads: 30')) return;

          this.notifications.update((list) => {
            const exists = list.some(
              (n) => String(n.id) === String(notif.id) || (n.title?.trim() === notif.title?.trim() && n.message?.trim() === notif.message?.trim())
            );
            if (exists) {
              return list.map((n) =>
                n.title?.trim() === notif.title?.trim() && n.message?.trim() === notif.message?.trim()
                  ? { ...notif, id: n.id }
                  : n
              );
            }
            return [notif, ...list];
          });
          if (!notif.isRead) {
            this.triggerToast(notif);
          }
        }
      });

      const syncOnTaskEvent = () => {
        this.loadNotifications();
      };
      this.socket.on('task:assigned', syncOnTaskEvent);
      this.socket.on('task:in_progress', syncOnTaskEvent);
      this.socket.on('task:submitted', syncOnTaskEvent);
      this.socket.on('task:approved', syncOnTaskEvent);
      this.socket.on('task:redesign_required', syncOnTaskEvent);
      this.socket.on('task:revision_required', syncOnTaskEvent);
      this.socket.on('task:updated', syncOnTaskEvent);
      this.socket.on('task:comment', syncOnTaskEvent);
      this.socket.on('lead:assigned', syncOnTaskEvent);
      this.socket.on('lead:created', syncOnTaskEvent);
      this.socket.on('lead:status_changed', syncOnTaskEvent);
      this.socket.on('call:completed', syncOnTaskEvent);
      this.socket.on('leads:batch_imported', syncOnTaskEvent);
      this.socket.on('telecaller_target:updated', syncOnTaskEvent);
    } catch (e) {
      console.log('[NotificationService] Socket.IO connection notice:', e);
    }
  }

  triggerToast(notif: NotificationItem): void {
    this.activeToast.set(notif);
    setTimeout(() => {
      if (this.activeToast()?.id === notif.id) {
        this.activeToast.set(null);
      }
    }, 6000);
  }

  closeToast(): void {
    this.activeToast.set(null);
  }

  async loadNotifications(): Promise<void> {
    try {
      const currentUser = this.authService.currentUser();
      const currentUserId = currentUser?.id || 'usr_admin_01';
      const currentUserRole = currentUser?.role || '';
      const currentUserName = currentUser?.fullName || '';
      const currentUserEmail = currentUser?.email || '';

      const res = await safeFetch(`/api/notifications?userId=${encodeURIComponent(currentUserId)}&role=${encodeURIComponent(currentUserRole)}&name=${encodeURIComponent(currentUserName)}&email=${encodeURIComponent(currentUserEmail)}`, {
        headers: {
          'x-user-id': currentUserId,
          'x-user-role': currentUserRole,
          'x-user-name': currentUserName,
          'x-user-email': currentUserEmail,
        },
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          const cleaned = data.filter((n: any) => {
            const m = String(n.message || '').toLowerCase();
            const t = String(n.title || '').toLowerCase();
            return !t.includes('30 leads') && !m.includes('total leads: 30');
          });

          const seen = new Set<string>();
          const deduped: NotificationItem[] = [];
          for (const item of cleaned.map(sanitizeNotification)) {
            if (!isNotificationAllowedForRole(item, currentUserRole)) {
              continue;
            }
            const key = `${item.title?.trim()}_${item.message?.trim()}`;
            if (!seen.has(key)) {
              seen.add(key);
              deduped.push(item);
            }
          }
          this.notifications.set(deduped);
        }
      }
    } catch (err) {
      console.log('Error loading notifications:', err);
    }
  }

  async markAsRead(id: string): Promise<void> {
 
    this.notifications.update((list) =>
      list.map((n) => (n.id === id ? { ...n, isRead: true } : n))
    );

    try {
      const currentUserId = this.authService.currentUser()?.id || 'usr_admin_01';
      await safeFetch(`/api/notifications/${id}/read`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUserId,
        },
      });
    } catch (err) {
      console.log('Error marking notification read:', err);
    }
  }

  async markAllAsRead(): Promise<void> {

    this.notifications.update((list) =>
      list.map((n) => ({ ...n, isRead: true }))
    );

    try {
      const currentUserId = this.authService.currentUser()?.id || 'usr_admin_01';
      await safeFetch(`/api/notifications/read-all`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUserId,
        },
      });
    } catch (err) {
      console.log('Error marking all notifications read:', err);
    }
  }

  getNotificationTargetRoute(notif: NotificationItem): string {
    const currentRole = this.authService.currentUser()?.role || '';
    const text = `${notif.title || ''} ${notif.message || ''}`.toLowerCase();

    // Prioritize Telecalling / Targets / Deficit warnings / Call achievements
    const isTelecallingOrTarget =
      text.includes('telecaller') ||
      text.includes('target deficit') ||
      text.includes('target achieved') ||
      text.includes('deficit warning') ||
      text.includes('daily target') ||
      text.includes('calls/day') ||
      text.includes('calls today') ||
      text.includes('daily calls') ||
      text.includes('target') ||
      text.includes('deficit') ||
      text.includes('quota') ||
      notif.targetRoute === '/targets' ||
      notif.targetRoute === '/telecalling' ||
      notif.targetRoute === '/calls' ||
      notif.targetRoute === '/follow-ups' ||
      notif.targetRoute === '/qualification' ||
      notif.targetRoute === '/outcomes' ||
      (notif.targetRoute?.includes('/targets') ?? false) ||
      (notif.targetRoute?.includes('/telecalling') ?? false) ||
      (notif.targetRoute?.includes('package-works') &&
        (notif.targetRoute.includes('TELECALLING') || notif.targetRoute.includes('telecalling')));

    if (isTelecallingOrTarget) {
      return TELECALLING_PACKAGE_TARGET_ROUTE;
    }

    // 1. Role-aware adjustment for explicit targetRoute
    if (notif.targetRoute) {
      if (currentRole === 'DESIGNER') {
        if (notif.targetRoute.startsWith('/tasks')) {
          if (notif.targetRoute.includes('revision') || text.includes('revision') || text.includes('redesign')) {
            return '/revisions';
          }
          if (notif.targetRoute.includes('submission') || text.includes('submission') || text.includes('upload') || text.includes('approved')) {
            return '/submissions';
          }
          return '/designer-tasks';
        }
        if (notif.targetRoute === '/tasks' || notif.targetRoute === '/designer-tasks') {
          return '/designer-tasks';
        }
        return notif.targetRoute;
      }

      if (currentRole === 'TELECALLER') {
        if (notif.targetRoute === '/leads' || notif.targetRoute.startsWith('/leads')) {
          return TELECALLING_PACKAGE_TARGET_ROUTE;
        }
        return notif.targetRoute;
      }

      if (currentRole === 'ADMINISTRATOR' || currentRole === 'BDM' || currentRole === 'MARKETING_MANAGER') {
        if (notif.targetRoute === '/designer-tasks' || notif.targetRoute === '/submissions' || notif.targetRoute === '/revisions') {
          return '/tasks?view=my';
        }
        if (notif.targetRoute.startsWith('/tasks') && !notif.targetRoute.includes('view=')) {
          return `${notif.targetRoute}${notif.targetRoute.includes('?') ? '&' : '?'}view=my`;
        }
        return notif.targetRoute;
      }

      return notif.targetRoute;
    }

    if (notif.link) return notif.link;

    // 2. Fallback text-based matching
    if (
      text.includes('task') ||
      text.includes('creative') ||
      text.includes('design') ||
      text.includes('revision') ||
      text.includes('version') ||
      text.includes('submission') ||
      text.includes('canvas') ||
      text.includes('brief')
    ) {
      if (currentRole === 'DESIGNER') {
        if (text.includes('revision')) return '/revisions';
        if (text.includes('submission') || text.includes('approved')) return '/submissions';
        return '/designer-tasks';
      }
      return '/tasks?view=my';
    }

    if (
      text.includes('package') ||
      text.includes('careermate') ||
      text.includes('brandmate') ||
      text.includes('growthmate') ||
      text.includes('marketmate') ||
      text.includes('launchmate')
    ) {
      return '/package-works';
    }

    if (text.includes('lead')) {
      if (currentRole === 'TELECALLER') {
        return TELECALLING_PACKAGE_TARGET_ROUTE;
      }
      if (text.includes('source')) {
        return '/lead-source';
      }
      return '/leads';
    }

    if (
      text.includes('campaign') ||
      text.includes('ad ') ||
      text.includes('ads') ||
      text.includes('meta') ||
      text.includes('creative ad') ||
      text.includes('cpc') ||
      text.includes('ctr')
    ) {
      if (text.includes('metric') || text.includes('ctr') || text.includes('cpc')) {
        return '/ad-metrics';
      }
      if (text.includes('ad ') || text.includes('ads')) {
        return '/ads';
      }
      return '/campaigns';
    }

    if (
      text.includes('transaction') ||
      text.includes('conversion') ||
      text.includes('revenue') ||
      text.includes('payment')
    ) {
      return '/transactions';
    }

    if (text.includes('achievement') || text.includes('reward')) {
      return currentRole === 'DESIGNER' ? '/achievements' : '/performance';
    }
    if (text.includes('performance') || text.includes('analytics') || text.includes('report')) {
      return '/reports';
    }

    if (text.includes('user') || text.includes('role') || text.includes('permission')) {
      return currentRole === 'ADMINISTRATOR' ? '/users-roles' : '/dashboard';
    }

    if (text.includes('audit') || text.includes('security') || text.includes('log')) {
      return '/audit-logs';
    }

    if (currentRole === 'DESIGNER') return '/designer-tasks';
    if (currentRole === 'TELECALLER') return TELECALLING_PACKAGE_TARGET_ROUTE;
    if (currentRole === 'BDM') return '/package-works';
    return '/dashboard';
  }

  handleNotificationClick(notif: NotificationItem): void {
    this.markAsRead(notif.id);
    this.closeToast();
    const route = this.getNotificationTargetRoute(notif);
    if (route) {
      if (this.router.url.startsWith('/package-works') && route.startsWith('/package-works')) {
        const urlTree = this.router.parseUrl(route);
        this.router.navigate(['/package-works'], {
          queryParams: urlTree.queryParams,
        });
      } else {
        this.router.navigateByUrl(route);
      }
    }
  }
}
