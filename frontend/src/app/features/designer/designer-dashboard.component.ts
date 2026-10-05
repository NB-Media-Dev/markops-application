import { Component, OnInit, signal, computed, inject, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { TaskManagementService } from '../../core/services/task-management.service';
import { AuthService } from '../../core/services/auth.service';
import { NotificationService } from '../../core/services/notification.service';
import { Task, TaskStatus, TaskPriority, TaskWorkCycle, TaskVersion, computeTaskProgressPercent } from '../../core/models/task.model';

import { UserManagementService } from '../../core/services/user-management.service';
import { PackageService } from '../../core/services/package.service';
import { FIXED_PACKAGES, isTaskForPackage } from '../../core/models/package.model';

import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { getBackendBaseUrl } from '../../core/utils/api-url.utils';

@Component({
  selector: 'app-designer-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterModule],
  templateUrl: './designer-dashboard.component.html',
  styleUrl: './designer-dashboard.component.scss',
})

export class DesignerDashboardComponent implements OnInit {
  readonly packageFilterSignal = signal<string | undefined>(undefined);
  @Input() set packageFilter(val: string | undefined) {
    this.packageFilterSignal.set(val);
    this.selectedDesignerId.set(null);
    if (!this.isDesigner()) {
      this.showDesignersDirectory.set(true);
    }
  }
  get packageFilter(): string | undefined {
    return this.packageFilterSignal();
  }

  readonly productFilterSignal = signal<string | undefined>(undefined);
  @Input() set productFilter(val: string | undefined) {
    this.productFilterSignal.set(val);
  }
  get productFilter(): string | undefined {
    return this.productFilterSignal();
  }

  @Input() embedded = false;

  private readonly fb = inject(FormBuilder);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly taskService = inject(TaskManagementService);
  readonly userService = inject(UserManagementService);
  readonly authService = inject(AuthService);
  readonly notifService = inject(NotificationService);
  readonly packageService = inject(PackageService);

  readonly statusFilter = signal<string>('ALL');
  readonly priorityFilter = signal<string>('ALL');
  readonly searchQuery = signal<string>('');
  readonly designerSearchQuery = signal<string>('');
  readonly selectedDesignerId = signal<string | null>(null);
  readonly showDesignersDirectory = signal<boolean>(true);

  readonly resolvedActiveProduct = computed<string | null>(() => {
    // 1. Explicit productFilter
    const prod = this.productFilterSignal()?.trim();
    if (prod) return prod;

    // 2. Derive from packageFilter
    const pkgFilter = this.packageFilterSignal()?.trim();
    if (pkgFilter) {
      const fixed = FIXED_PACKAGES.find((p) => p.name.toLowerCase() === pkgFilter.toLowerCase());
      if (fixed) return fixed.name;

      const dbPkgs = this.packageService.packages();
      const match = dbPkgs.find((p) => p.name.toLowerCase().trim() === pkgFilter.toLowerCase());
      if (match && match.productId) {
        const fixedByProdId = FIXED_PACKAGES.find(
          (fp) => fp.id.toLowerCase() === match.productId.toLowerCase() ||
                  fp.name.toLowerCase().includes(match.productId.toLowerCase().replace('pkg_', ''))
        );
        if (fixedByProdId) return fixedByProdId.name;
        return match.productId;
      }
    }
    return null;
  });

  readonly availablePackagesList = computed<{ name: string; icon: string }[]>(() => {
    const map = new Map<string, { name: string; icon: string }>();
    const activeProd = this.resolvedActiveProduct();
    const filterPkg = this.packageFilterSignal()?.trim();
    const dbPkgs = this.packageService.packages();

    if (activeProd) {
      const fixedProd = FIXED_PACKAGES.find(
        (p) => p.name.toLowerCase() === activeProd.toLowerCase() || p.id.toLowerCase() === activeProd.toLowerCase()
      );
      const activeProdId = (fixedProd?.id || activeProd).toLowerCase();
      const activeProdName = fixedProd?.name || activeProd;

      // 1. If currently inside a specific workspace package, add it FIRST
      if (filterPkg && (!fixedProd || filterPkg.toLowerCase() !== fixedProd.name.toLowerCase())) {
        map.set(filterPkg.toLowerCase(), {
          name: filterPkg,
          icon: 'inventory_2',
        });
      }

      // 2. Add packages from Database belonging ONLY to this product
      for (const p of dbPkgs) {
        if (!p.name || !p.name.trim()) continue;
        const pProd = (p.productId || '').toLowerCase().trim();
        const matchesProduct =
          pProd === activeProdId ||
          (activeProdName.toLowerCase().includes('career') && (pProd.includes('career') || pProd === 'pkg_careermate')) ||
          (activeProdName.toLowerCase().includes('class') && (pProd.includes('class') || pProd === 'pkg_classmate')) ||
          ((activeProdName.toLowerCase().includes('jesus') || activeProdName.toLowerCase().includes('messang')) &&
            (pProd.includes('jesus') || pProd.includes('messang') || pProd === 'pkg_jesus_messanger'));

        if (matchesProduct && !map.has(p.name.toLowerCase().trim())) {
          map.set(p.name.toLowerCase().trim(), {
            name: p.name.trim(),
            icon: 'inventory_2',
          });
        }
      }

      // 3. Only if no package has been created at all under this product, use the base product name
      if (map.size === 0 && fixedProd) {
        map.set(fixedProd.name.toLowerCase(), {
          name: fixedProd.name,
          icon: fixedProd.icon,
        });
      }
    } else {
      // Global / Standalone Mode (No product filter)
      if (filterPkg) {
        map.set(filterPkg.toLowerCase(), {
          name: filterPkg,
          icon: 'inventory_2',
        });
      }

      for (const p of dbPkgs) {
        if (p.name && p.name.trim() && !map.has(p.name.toLowerCase().trim())) {
          map.set(p.name.toLowerCase().trim(), { name: p.name.trim(), icon: 'inventory_2' });
        }
      }

      if (map.size === 0) {
        for (const pkg of FIXED_PACKAGES) {
          if (!map.has(pkg.name.toLowerCase())) {
            map.set(pkg.name.toLowerCase(), { name: pkg.name, icon: pkg.icon });
          }
        }
      }
    }

    return Array.from(map.values());
  });

  get availablePackages() {
    return this.availablePackagesList();
  }

  readonly todayDate = new Date().toISOString().split('T')[0];
  readonly yesterdayDate = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  readonly selectedDateFilter = signal<string>('');

  setDateFilter(dateStr: string): void {
    this.selectedDateFilter.set(dateStr || '');
  }

  setQuickDate(preset: 'today' | 'yesterday' | 'all'): void {
    if (preset === 'today') {
      this.selectedDateFilter.set(this.todayDate);
    } else if (preset === 'yesterday') {
      this.selectedDateFilter.set(this.yesterdayDate);
    } else {
      this.selectedDateFilter.set('');
    }
  }

  clearDateFilter(): void {
    this.selectedDateFilter.set('');
  }

  readonly formattedSelectedDate = computed<string>(() => {
    const d = this.selectedDateFilter();
    if (!d) return '';
    try {
      const parts = d.split('-');
      if (parts.length === 3) {
        const dt = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        return dt.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
      }
      return d;
    } catch {
      return d;
    }
  });

  readonly canCreateTask = computed<boolean>(() => {
    const role = this.authService.currentUser()?.role;
    return role === 'ADMINISTRATOR' || role === 'MARKETING_MANAGER' || role === 'BDM';
  });

  readonly canSwitchTaskView = computed<boolean>(() => {
    const role = this.authService.currentUser()?.role;
    return role === 'ADMINISTRATOR' || role === 'MARKETING_MANAGER' || role === 'BDM' || role === 'DIGITAL_MARKETING';
  });

  readonly activeTaskView = computed<'all' | 'my'>(() => this.taskService.activeView());

  switchTaskView(view: 'all' | 'my'): void {
    this.showDesignersDirectory.set(false);
    this.taskService.switchView(view);
  }

  toggleDesignersDirectory(): void {
    this.showDesignersDirectory.update((v) => !v);
  }

  canDeleteTask(task?: Task | null): boolean {
    if (!task) return false;
    return this.isTaskCreator(task);
  }

  getPackageIcon(packageName?: string): string {
    const targetName = (packageName || this.packageFilterSignal() || 'Careermate').toLowerCase().trim();
    const pkg = this.availablePackagesList().find((p) => p.name.toLowerCase().trim() === targetName);
    return pkg?.icon || 'palette';
  }

  readonly isManager = computed<boolean>(() => {
    const role = this.authService.currentUser()?.role;
    return role === 'ADMINISTRATOR' || role === 'MARKETING_MANAGER';
  });

  readonly isDesigner = computed<boolean>(() => {
    return this.authService.currentUser()?.role === 'DESIGNER';
  });

  readonly isBDM = computed<boolean>(() => {
    return this.authService.currentUser()?.role === 'BDM';
  });

  readonly isAdmin = computed<boolean>(() => {
    return this.authService.currentUser()?.role === 'ADMINISTRATOR';
  });

  readonly isMarketingManager = computed<boolean>(() => {
    return this.authService.currentUser()?.role === 'MARKETING_MANAGER';
  });

  isTaskCreator(task: Task | null): boolean {
    if (!task) return false;
    const currentUser = this.authService.currentUser();
    if (!currentUser) return false;

    const currentId = String(currentUser.id !== undefined && currentUser.id !== null ? currentUser.id : '').trim().toLowerCase();
    const currentEmail = String(currentUser.email || '').toLowerCase().trim();
    const currentName = String(currentUser.fullName || '').toLowerCase().trim();
    const currentRole = String(currentUser.role || '').toUpperCase();

    const tCreatorId = String(
      task.createdBy !== undefined && task.createdBy !== null
        ? task.createdBy
        : ((task as any).created_by !== undefined && (task as any).created_by !== null ? (task as any).created_by : '')
    ).trim().toLowerCase();
    const tCreatorEmail = String(task.creatorEmail || (task as any).creator_email || '').toLowerCase().trim();
    const tCreatorName = String(task.creatorName || (task as any).creator_name || '').toLowerCase().trim();
    const tCreatorRole = String(task.creatorRole || (task as any).creator_role || '').toUpperCase();

    const matchesId = Boolean(currentId && tCreatorId && (currentId === tCreatorId || (currentRole === 'ADMINISTRATOR' && (tCreatorId === '1' || tCreatorId === 'usr_admin_01'))));
    const matchesEmail = Boolean(currentEmail && tCreatorEmail && currentEmail === tCreatorEmail);
    const matchesName = Boolean(currentName && tCreatorName && (currentName === tCreatorName || tCreatorName.includes(currentName)));
    const matchesAdmin = currentRole === 'ADMINISTRATOR' && (tCreatorRole === 'ADMINISTRATOR' || tCreatorName.includes('admin') || tCreatorId === '1' || tCreatorId === 'usr_admin_01');

    return matchesId || matchesEmail || matchesName || matchesAdmin;
  }

  canStartWork(task: Task | null): boolean {
    if (!task) return false;
    return task.status === 'ASSIGNED' && this.isDesigner();
  }

  canUploadDesign(task: Task | null): boolean {
    if (!task) return false;
    return task.status === 'IN_PROGRESS' && this.isDesigner();
  }

  canStartRedesign(task: Task | null): boolean {
    if (!task) return false;
    return (task.status === 'REDESIGN_REQUIRED' || task.status === 'REVISION_REQUIRED') && this.isDesigner();
  }

  canReview(task: Task | null): boolean {
    if (!task) return false;
    return task.status === 'SUBMITTED' && this.isTaskCreator(task);
  }

  getTaskProgress(task: Task | null | undefined): number {
    if (!task) return 0;
    return computeTaskProgressPercent(task.status, task.progressPercent);
  }

  getShortCreator(task: Task | null): string {
    const raw = this.getCreatorName(task);
    if (!raw || raw === 'System Administrator' || raw === 'admin@markops.io' || raw === 'Manager') {
      return this.getRolePrefix(task?.creatorRole) || 'Admin';
    }
    const prefix = this.getRolePrefix(task?.creatorRole);
    const firstName = raw.split(' ')[0];
    return prefix && prefix !== firstName ? `${prefix}(${firstName})` : firstName;
  }

  getShortAssignee(task: Task | null): string {
    const raw = this.getAssigneeName(task);
    if (!raw || raw === 'Assigned Designer' || raw === 'Assigned User' || raw === 'Designer') {
      return 'Designer';
    }
    const firstName = raw.split(' ')[0];
    return firstName;
  }

  hasCustomDescription(task: Task | null): boolean {
    if (!task) return false;
    const desc = (task.description || '').trim();
    if (!desc) return false;
    if (desc.startsWith('Document File:') || (desc.includes('File Size:') && desc.includes('File Type:'))) {
      return false;
    }
    if (task.attachmentName && desc.toLowerCase() === task.attachmentName.trim().toLowerCase()) {
      return false;
    }
    return true;
  }

  getCleanDescription(task: Task | null): string {
    if (!this.hasCustomDescription(task)) return '';
    return task!.description!.trim();
  }

  getWorkCycles(task: Task | null): TaskWorkCycle[] {
    if (!task || !task.statusHistory || task.statusHistory.length === 0) return [];

    const history = [...task.statusHistory].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    const cycles: TaskWorkCycle[] = [];
    let currentStart: string | null = null;
    let cycleCounter = 1;

    for (const h of history) {
      if (h.newStatus === 'IN_PROGRESS') {
        currentStart = h.createdAt;
      } else if (h.newStatus === 'SUBMITTED' && currentStart) {
        const startMs = new Date(currentStart).getTime();
        const endMs = new Date(h.createdAt).getTime();
        const diffMinutes = Math.max(1, Math.round((endMs - startMs) / 60000));
        const hours = Math.floor(diffMinutes / 60);
        const minutes = diffMinutes % 60;
        const durationText = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

        cycles.push({
          cycleNumber: cycleCounter++,
          startedAt: currentStart,
          submittedAt: h.createdAt,
          durationMinutes: diffMinutes,
          durationText,
          isCurrent: false,
        });
        currentStart = null;
      }
    }

    if (currentStart && task.status === 'IN_PROGRESS') {
      const startMs = new Date(currentStart).getTime();
      const nowMs = Date.now();
      const diffMinutes = Math.max(1, Math.round((nowMs - startMs) / 60000));
      const hours = Math.floor(diffMinutes / 60);
      const minutes = diffMinutes % 60;
      const durationText = hours > 0 ? `${hours}h ${minutes}m (active)` : `${minutes}m (active)`;

      cycles.push({
        cycleNumber: cycleCounter,
        startedAt: currentStart,
        durationMinutes: diffMinutes,
        durationText,
        isCurrent: true,
      });
    }

    return cycles;
  }

  getTotalWorkDuration(task: Task | null): string {
    const cycles = this.getWorkCycles(task);
    if (cycles.length === 0) return 'Not started';
    const totalMinutes = cycles.reduce((acc, c) => acc + (c.durationMinutes || 0), 0);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  }

  getVersionDuration(task: Task | null, ver: TaskVersion): string {
    if (!task || !ver || !ver.createdAt) return '';

    const verTime = new Date(ver.createdAt).getTime();
    if (isNaN(verTime)) return '';

    // Strategy 1: Check work cycles
    const cycles = this.getWorkCycles(task);
    if (cycles.length > 0) {
      const matchedByTime = cycles.find(
        (c) => c.submittedAt && Math.abs(new Date(c.submittedAt).getTime() - verTime) < 15000
      );
      if (matchedByTime && matchedByTime.durationText) {
        return matchedByTime.durationText;
      }

      if (ver.versionNumber && ver.versionNumber > 0) {
        const matchedByNum = cycles.find((c) => c.cycleNumber === ver.versionNumber);
        if (matchedByNum && matchedByNum.durationText) {
          return matchedByNum.durationText;
        }
      }
    }

    // Strategy 2: Direct status history search (from IN_PROGRESS to ver.createdAt)
    if (task.statusHistory && task.statusHistory.length > 0) {
      const sortedHistory = [...task.statusHistory]
        .filter((h) => h.createdAt && !isNaN(new Date(h.createdAt).getTime()))
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      let lastStart: number | null = null;
      for (const h of sortedHistory) {
        const hTime = new Date(h.createdAt).getTime();
        if (hTime > verTime + 5000) break;

        if (h.newStatus === 'IN_PROGRESS') {
          lastStart = hTime;
        } else if (h.newStatus === 'SUBMITTED' && lastStart && Math.abs(hTime - verTime) < 15000) {
          return this.formatDurationMs(hTime - lastStart);
        }
      }

      if (lastStart && lastStart <= verTime) {
        return this.formatDurationMs(verTime - lastStart);
      }
    }

    // Strategy 3: Compare to previous version
    if (task.versions && task.versions.length > 1) {
      const sortedVers = [...task.versions]
        .filter((v) => v.createdAt && !isNaN(new Date(v.createdAt).getTime()))
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      const curIdx = sortedVers.findIndex((v) => v.id === ver.id);
      if (curIdx > 0) {
        const prevTime = new Date(sortedVers[curIdx - 1].createdAt).getTime();
        if (verTime > prevTime) {
          return this.formatDurationMs(verTime - prevTime);
        }
      }
    }

    // Strategy 4: Compare to task.createdAt
    if (task.createdAt) {
      const taskCreatedTime = new Date(task.createdAt).getTime();
      if (!isNaN(taskCreatedTime) && verTime >= taskCreatedTime) {
        return this.formatDurationMs(verTime - taskCreatedTime);
      }
    }

    return '< 1m';
  }

  formatDurationMs(diffMs: number): string {
    if (diffMs <= 0) return '< 1m';
    if (diffMs < 60000) {
      const seconds = Math.max(1, Math.round(diffMs / 1000));
      return `${seconds}s`;
    }
    const totalMinutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  getInitials(name: string): string {
    if (!name) return 'D';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  getAvatarColor(name: string): string {
    const colors = ['#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626', '#0891b2', '#4f46e5', '#db2777'];
    let hash = 0;
    for (let i = 0; i < (name || '').length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }

  readonly realDesignersList = computed(() => {
    const allUsers = this.userService.users();
    const designers = allUsers.filter((u) => u.role === 'DESIGNER');
    return designers.map((u) => ({
      id: u.id,
      name: u.fullName,
      email: u.email,
      department: u.department || 'Creative Design',
    }));
  });

  readonly designersSummaryList = computed(() => {
    const designers = this.realDesignersList();
    const allTasks = this.taskService.tasks();
    const pkgFilter = this.packageFilterSignal();

    const designerMap = new Map<string, {
      id: string;
      name: string;
      email: string;
      department: string;
      avatarColor: string;
      totalCount: number;
      completedCount: number;
      pendingCount: number;
      inProgressCount: number;
      submittedCount: number;
      revisionCount: number;
      completionRate: number;
    }>();

    for (const d of designers) {
      const dIdStr = String(d.id || '');
      const dNameStr = String(d.name || '');
      const dEmailStr = String(d.email || `${dNameStr.toLowerCase().replace(/\s+/g, '.')}@markops.io`);
      designerMap.set(dIdStr, {
        id: dIdStr,
        name: dNameStr,
        email: dEmailStr,
        department: d.department || 'Creative Design',
        avatarColor: this.getAvatarColor(dNameStr),
        totalCount: 0,
        completedCount: 0,
        pendingCount: 0,
        inProgressCount: 0,
        submittedCount: 0,
        revisionCount: 0,
        completionRate: 0,
      });
    }


    const currentUser = this.authService.currentUser();
    const currentRole = currentUser?.role;
    const currentUserId = String(currentUser?.id || '').toLowerCase().trim();
    const currentUserName = String(currentUser?.fullName || '').toLowerCase().trim();
    const currentUserEmail = String(currentUser?.email || '').toLowerCase().trim();

    const dateFilter = this.selectedDateFilter();
    const tasksToCount = allTasks.filter((t) => {
      if (currentRole === 'DESIGNER') {
        const isAssignedToMe =
          (t.assignedTo !== undefined && String(t.assignedTo).toLowerCase().trim() === currentUserId) ||
          (currentUserEmail && t.assignedTo !== undefined && String(t.assignedTo).toLowerCase().trim() === currentUserEmail);
        if (!isAssignedToMe) return false;
      }


      if (pkgFilter && !isTaskForPackage(t, pkgFilter, this.packageService.packages())) {
        return false;
      }
      if (dateFilter) {
        const createdDate = t.createdAt ? t.createdAt.split('T')[0] : '';
        const dueDate = t.dueDate ? t.dueDate.split('T')[0] : '';
        const updatedDate = t.updatedAt ? t.updatedAt.split('T')[0] : '';
        if (createdDate !== dateFilter && dueDate !== dateFilter && updatedDate !== dateFilter) {
          return false;
        }
      }
      return true;
    });


    for (const t of tasksToCount) {
      let matchedId: string | null = null;
      const tAssignedToStr = String(t.assignedTo || '').toLowerCase().trim();
      const tAssigneeNameStr = String(t.assigneeName || '').toLowerCase().trim();
      const tCreatedByStr = String(t.createdBy || '').toLowerCase().trim();

      for (const d of designers) {
        const dIdStr = String(d.id || '').toLowerCase().trim();
        const dNameStr = String(d.name || '').toLowerCase().trim();
        const dEmailStr = String(d.email || '').toLowerCase().trim();

        if (
          (tAssignedToStr && (tAssignedToStr === dIdStr || tAssignedToStr === dEmailStr)) ||
          (tAssigneeNameStr && (tAssigneeNameStr === dNameStr || tAssigneeNameStr.includes(dNameStr) || dNameStr.includes(tAssigneeNameStr)))
        ) {
          matchedId = String(d.id);
          break;
        }
      }

      if (!matchedId) {
        if (
          t.assigneeName &&
          t.assigneeName !== 'Assigned User' &&
          t.assigneeName !== 'Designer' &&
          t.assigneeName !== 'Assigned Designer' &&
          t.assigneeName !== 'Unassigned'
        ) {
          const customId = `d_${String(t.assigneeName).toLowerCase().replace(/\s+/g, '_')}`;
          if (!designerMap.has(customId)) {
            designerMap.set(customId, {
              id: customId,
              name: String(t.assigneeName),
              email: `${String(t.assigneeName).toLowerCase().replace(/\s+/g, '.')}@markops.io`,
              department: 'Creative Design',
              avatarColor: this.getAvatarColor(String(t.assigneeName)),
              totalCount: 0,
              completedCount: 0,
              pendingCount: 0,
              inProgressCount: 0,
              submittedCount: 0,
              revisionCount: 0,
              completionRate: 0,
            });
          }
          matchedId = customId;
        }
      }

      if (matchedId && designerMap.has(matchedId)) {
        const entry = designerMap.get(matchedId)!;
        entry.totalCount++;

        const isCompleted = t.status === 'APPROVED' || t.status === 'PUBLISHED' || t.status === 'COMPLETED';
        const isInProgress = t.status === 'IN_PROGRESS' || t.status === 'ACCEPTED';
        const isReview = t.status === 'SUBMITTED' || t.status === 'RESUBMITTED' || t.status === 'UNDER_REVIEW';
        const isRevision = t.status === 'REVISION_REQUIRED';

        if (isCompleted) {
          entry.completedCount++;
        } else {
          entry.pendingCount++;
        }

        if (isInProgress) entry.inProgressCount++;
        if (isReview) entry.submittedCount++;
        if (isRevision) entry.revisionCount++;
      }
    }

    return Array.from(designerMap.values()).map((d) => {
      const rate = d.totalCount > 0 ? Math.round((d.completedCount / d.totalCount) * 100) : 0;
      return {
        ...d,
        completionRate: rate,
      };
    });
  });

  readonly filteredDesigners = computed(() => {
    const query = String(this.designerSearchQuery() || '').toLowerCase().trim();
    const list = this.designersSummaryList();
    if (!query) return list;
    return list.filter(
      (d) =>
        String(d.name || '').toLowerCase().includes(query) ||
        String(d.email || '').toLowerCase().includes(query) ||
        String(d.department || '').toLowerCase().includes(query)
    );
  });

  readonly selectedDesigner = computed(() => {
    const id = this.selectedDesignerId();
    if (!id) return null;
    const idStr = String(id);
    return this.designersSummaryList().find((d) => String(d.id) === idStr) || null;
  });

  readonly totalAllDesigners = computed(() => this.designersSummaryList().length);
  readonly totalAllTasks = computed(() => this.designersSummaryList().reduce((acc, d) => acc + d.totalCount, 0));
  readonly totalAllPending = computed(() => this.designersSummaryList().reduce((acc, d) => acc + d.pendingCount, 0));
  readonly totalAllCompleted = computed(() => this.designersSummaryList().reduce((acc, d) => acc + d.completedCount, 0));
  readonly totalMyTasks = computed(() => {
    const pkgFilter = this.packageFilterSignal();
    const tasks = pkgFilter ? this.taskService.tasks().filter((t) => isTaskForPackage(t, pkgFilter, this.packageService.packages())) : this.taskService.tasks();
    const isDes = this.isDesigner();
    const currentUser = this.authService.currentUser();
    const currentUserId = String(currentUser?.id || '').toLowerCase().trim();
    const currentUserEmail = String(currentUser?.email || '').toLowerCase().trim();
    const currentUserName = String(currentUser?.fullName || '').toLowerCase().trim();

    return tasks.filter((t) => {
      if (isDes) {
        const tAssignedToStr = String(t.assignedTo || (t as any).assigned_to || '').toLowerCase().trim();
        const tAssigneeNameStr = String(t.assigneeName || (t as any).assignee_name || '').toLowerCase().trim();
        return (tAssignedToStr && (tAssignedToStr === currentUserId || (currentUserEmail && tAssignedToStr === currentUserEmail))) ||
               (tAssigneeNameStr && currentUserName && (tAssigneeNameStr === currentUserName || tAssigneeNameStr.includes(currentUserName)));
      }
      return this.isTaskCreator(t);
    }).length;
  });
  readonly totalBdmTasks = computed(() => {
    const pkgFilter = this.packageFilterSignal();
    const tasks = pkgFilter ? this.taskService.tasks().filter((t) => isTaskForPackage(t, pkgFilter, this.packageService.packages())) : this.taskService.tasks();
    return tasks.filter((t) => t.creatorRole === 'BDM' || Boolean(t.createdBy && String(t.createdBy).toLowerCase().includes('bdm'))).length;
  });

  viewDesignerTasks(designerId: string | number): void {
    this.selectedDesignerId.set(String(designerId));
    this.showDesignersDirectory.set(false);
    this.taskService.closeTaskDetail();
  }

  backToDesignersList(): void {
    this.selectedDesignerId.set(null);
    this.showDesignersDirectory.set(true);
    this.taskService.closeTaskDetail();
  }

  clearDesignerFilter(): void {
    this.selectedDesignerId.set(null);
    this.designerSearchQuery.set('');
  }

  onPriorityFilterChange(event: Event): void {
    const val = (event.target as HTMLSelectElement).value;
    this.priorityFilter.set(val || 'ALL');
  }

  onDesignerSearch(event: Event): void {
    this.designerSearchQuery.set((event.target as HTMLInputElement).value);
  }


  readonly isUploadModalOpen = signal<boolean>(false);
  readonly isReviewModalOpen = signal<boolean>(false);
  readonly isCreateTaskModalOpen = signal<boolean>(false);
  readonly activeModalTaskId = signal<string | null>(null);
  readonly selectedFileObject = signal<File | null>(null);
  readonly selectedFileDataUrl = signal<string>('');
  readonly selectedFileContent = signal<string>('');
  readonly createdBriefFile = signal<File | null>(null);
  readonly createdBriefFileName = signal<string>('');
  readonly createdBriefDataUrl = signal<string>('');
  readonly createdBriefContent = signal<string>('');


  readonly isDocViewerOpen = signal<boolean>(false);
  readonly activeDocName = signal<string>('');
  readonly activeDocUrl = signal<string>('');
  readonly activeDocContent = signal<string>('');

  readonly activeIframeUrl = computed<SafeResourceUrl | null>(() => {
    let url = this.activeDocUrl();
    if (!url || url === '#') return null;

    if (url.startsWith('/uploads/')) {
      url = `${getBackendBaseUrl()}${url}`;
    }

    if (url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:')) {
      return this.sanitizer.bypassSecurityTrustResourceUrl(url);
    }
    return null;
  });

  readonly rawDocDownloadUrl = computed<string>(() => {
    const url = this.activeDocUrl();
    if (!url || url === '#') return '';
    if (url.startsWith('/uploads/')) {
      return `${getBackendBaseUrl()}${url}`;
    }
    return url;
  });

  readonly activeIframeSrcdoc = computed<string>(() => {
    const title = this.escapeHtml(this.activeDocName() || 'Document Preview');
    const rawContent = this.activeDocContent() || 'No text content available for this asset.';
    const content = this.escapeHtml(rawContent);

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 24px; margin: 0; line-height: 1.6; }
    .doc-header { font-size: 18px; font-weight: 700; color: #38bdf8; border-bottom: 1px solid #334155; padding-bottom: 12px; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
    .doc-body { font-size: 14px; color: #e2e8f0; white-space: pre-wrap; background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 20px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; line-height: 1.7; word-break: break-word; }
  </style>
</head>
<body>
  <div class="doc-header"><span class="material-symbols-outlined" style="font-size:20px;">description</span> ${title}</div>
  <div class="doc-body">${content}</div>
</body>
</html>`;
  });

  private escapeHtml(str: string): string {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  readonly copySuccess = signal<string | null>(null);

 
  readonly uploadForm: FormGroup = this.fb.group({
    fileName: ['', [Validators.required]],
    changelog: ['', [Validators.required]],
    fileSizeMb: [0],
  });

  readonly reviewForm: FormGroup = this.fb.group({
    action: ['APPROVE', [Validators.required]],
    remark: ['', [Validators.required, Validators.minLength(5)]],
  });

  readonly createTaskForm: FormGroup = this.fb.group({
    title: ['', [Validators.required, Validators.minLength(3)]],
    packageName: ['Careermate', [Validators.required]],
    description: [''],
    assignedTo: ['', [Validators.required]],
    priority: ['HIGH' as TaskPriority, [Validators.required]],
    dueDate: [new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0], [Validators.required]],
  });

  readonly filteredTasks = computed(() => {
    const list = this.taskService.tasks();
    const query = String(this.searchQuery() || '').toLowerCase().trim();
    const filter = this.statusFilter();
    const currentUser = this.authService.currentUser();
    const currentRole = currentUser?.role;
    const currentUserId = String(currentUser?.id || '').toLowerCase().trim();
    const currentUserName = String(currentUser?.fullName || '').toLowerCase().trim();
    const currentUserEmail = String(currentUser?.email || '').toLowerCase().trim();
    const selDesigner = this.selectedDesigner();
    const seenIds = new Set<string>();

    return list.filter((t) => {
      if (!t || !t.id) return false;
      const tid = String(t.id);
      if (seenIds.has(tid)) return false;
      seenIds.add(tid);

      const tAssignedToStr = String(t.assignedTo || '').toLowerCase().trim();
      const tAssigneeNameStr = String(t.assigneeName || '').toLowerCase().trim();

      if (currentRole === 'DESIGNER') {
        const isAssignedToMe =
          (tAssignedToStr && (tAssignedToStr === currentUserId || (currentUserEmail && tAssignedToStr === currentUserEmail))) ||
          (tAssigneeNameStr && currentUserName && (tAssigneeNameStr === currentUserName || tAssigneeNameStr.includes(currentUserName)));

        if (!isAssignedToMe) {
          return false;
        }
      } else {

        if (this.activeTaskView() === 'my') {
          const isCreatedByMe = this.isTaskCreator(t);
          if (!isCreatedByMe) {
            return false;
          }
        }


        if (selDesigner) {
          const dIdStr = String(selDesigner.id || '').toLowerCase().trim();
          const dNameStr = String(selDesigner.name || '').toLowerCase().trim();
          const dEmailStr = String(selDesigner.email || '').toLowerCase().trim();

          const matches =
            (tAssignedToStr && (tAssignedToStr === dIdStr || (dEmailStr && tAssignedToStr === dEmailStr))) ||
            (tAssigneeNameStr && (tAssigneeNameStr === dNameStr || tAssigneeNameStr.includes(dNameStr) || dNameStr.includes(tAssigneeNameStr)));

          if (!matches) {
            return false;
          }
        }
      }

      const pkgFilter = this.packageFilterSignal();
      if (pkgFilter) {
        if (!isTaskForPackage(t, pkgFilter, this.packageService.packages())) {
          return false;
        }
      }

      const dateFilter = this.selectedDateFilter();
      if (dateFilter) {
        const createdDate = t.createdAt ? t.createdAt.split('T')[0] : '';
        const dueDate = t.dueDate ? t.dueDate.split('T')[0] : '';
        const updatedDate = t.updatedAt ? t.updatedAt.split('T')[0] : '';
        if (createdDate !== dateFilter && dueDate !== dateFilter && updatedDate !== dateFilter) {
          return false;
        }
      }

      const priority = this.priorityFilter();
      if (priority && priority !== 'ALL') {
        if (String(t.priority || '').toUpperCase() !== priority.toUpperCase()) {
          return false;
        }
      }

      const matchesSearch =
        !query ||
        String(t.title || '').toLowerCase().includes(query) ||
        String(t.campaignName || '').toLowerCase().includes(query) ||
        String(t.description || '').toLowerCase().includes(query) ||
        String(t.content || '').toLowerCase().includes(query);

      let matchesStatus = true;
      if (filter === 'IN_PROGRESS') {
        matchesStatus = t.status === 'IN_PROGRESS' || t.status === 'ACCEPTED';
      } else if (filter === 'REVISION_REQUIRED') {
        matchesStatus = t.status === 'REVISION_REQUIRED';
      } else if (filter === 'SUBMITTED') {
        matchesStatus = t.status === 'SUBMITTED' || t.status === 'RESUBMITTED' || t.status === 'UNDER_REVIEW';
      } else if (filter === 'COMPLETED') {
        matchesStatus = t.status === 'APPROVED' || t.status === 'PUBLISHED' || t.status === 'COMPLETED';
      } else if (filter === 'BDM_FLOW') {
        matchesStatus = t.creatorRole === 'BDM' || Boolean(t.createdBy && String(t.createdBy).toLowerCase().includes('bdm'));
      }

      return matchesSearch && matchesStatus;
    });
  });

  async ngOnInit(): Promise<void> {
    await this.authService.ensureInitialized();

    // Check route query params to support navigating directly to My Tasks / All Tasks
    this.route.queryParams.subscribe((params) => {
      const view = params['view'] || params['tab'];
      if (view === 'my' || view === 'my_tasks' || view === 'my-tasks') {
        this.showDesignersDirectory.set(false);
        this.selectedDesignerId.set(null);
        this.switchTaskView('my');
      } else if (view === 'all' || view === 'all_tasks' || view === 'all-tasks') {
        this.showDesignersDirectory.set(false);
        this.selectedDesignerId.set(null);
        this.switchTaskView('all');
      } else if (view === 'designers' || view === 'designer') {
        this.showDesignersDirectory.set(true);
        this.selectedDesignerId.set(null);
      } else if (this.isDesigner()) {
        this.showDesignersDirectory.set(false);
      } else if (!this.embedded) {
        this.showDesignersDirectory.set(true);
      }

      const taskId = params['taskId'] || params['id'];
      if (taskId) {
        this.taskService.selectTask(taskId);
        this.activeDetailTab.set('DETAIL');
      }
    });

    if (this.authService.isAuthenticated()) {
      await Promise.all([
        this.taskService.loadTasks(),
        this.taskService.loadDesignerMetrics(),
        this.notifService.loadNotifications(),
        this.userService.loadUsersFromDatabase(),
      ]);
      this.packageService.loadAllPackages().subscribe();
    }
  }

  copyContentToClipboard(content: string, taskId: string): void {
    if (!content) return;
    navigator.clipboard.writeText(content).then(() => {
      this.copySuccess.set(taskId);
      setTimeout(() => this.copySuccess.set(null), 3000);
    });
  }

  openDocViewer(event: Event, url?: string, name?: string, content?: string): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    const docName = name || 'Content Document';
    let docUrl = url && url !== '#' ? url : '';
    const docContent = content || 'Document brief details and specifications for this creative task.';


    if (docUrl.startsWith('data:application/pdf') || docUrl.startsWith('data:image/')) {
      try {
        const parts = docUrl.split(',');
        const mime = parts[0].match(/:(.*?);/)?.[1] || 'application/pdf';
        const bstr = atob(parts[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
          u8arr[n] = bstr.charCodeAt(n);
        }
        const blob = new Blob([u8arr], { type: mime });
        docUrl = URL.createObjectURL(blob);
      } catch (e) {}
    }

    this.activeDocName.set(docName);
    this.activeDocUrl.set(docUrl);
    this.activeDocContent.set(docContent);
    this.isDocViewerOpen.set(true);
  }

  closeDocViewer(): void {
    this.isDocViewerOpen.set(false);
  }

  onSearch(event: Event): void {
    this.searchQuery.set((event.target as HTMLInputElement).value);
  }

  setFilter(filter: string): void {
    this.statusFilter.set(filter);
  }

  onFilterChange(event: Event): void {
    const val = (event.target as HTMLSelectElement).value;
    if (val) {
      this.setFilter(val);
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      this.selectedFileObject.set(file);
      const sizeMb = Number((file.size / (1024 * 1024)).toFixed(2));
      this.uploadForm.patchValue({
        fileName: file.name,
        fileSizeMb: sizeMb > 0 ? sizeMb : 0.5,
      });

      const reader = new FileReader();
      reader.onload = (e: ProgressEvent<FileReader>) => {
        this.selectedFileDataUrl.set((e.target?.result as string) || '');
      };
      reader.readAsDataURL(file);

      if (
        file.type.startsWith('text/') ||
        file.name.endsWith('.txt') ||
        file.name.endsWith('.json') ||
        file.name.endsWith('.md') ||
        file.name.endsWith('.csv') ||
        file.name.endsWith('.html')
      ) {
        const textReader = new FileReader();
        textReader.onload = (e: ProgressEvent<FileReader>) => {
          this.selectedFileContent.set((e.target?.result as string) || '');
        };
        textReader.readAsText(file);
      } else {
        this.selectedFileContent.set(`Design File: ${file.name}\nFile Size: ${(file.size / 1024).toFixed(1)} KB\nFile Type: ${file.type || 'Binary asset'}`);
      }
    }
  }

  
  async startWork(task: Task): Promise<void> {
    await this.taskService.startWork(task.id);
    await this.notifService.loadNotifications();
  }

  async startRedesign(task: Task): Promise<void> {
    await this.taskService.startRedesign(task.id);
    await this.notifService.loadNotifications();
  }

  async onApproveQuick(task: Task): Promise<void> {
    await this.taskService.approveTask(task.id);
    await this.notifService.loadNotifications();
  }


  readonly isRedesignModalOpen = signal<boolean>(false);
  readonly redesignReason = signal<string>('');

  openRedesignModal(task: Task): void {
    this.activeModalTaskId.set(task.id);
    this.redesignReason.set('');
    this.isRedesignModalOpen.set(true);
  }

  closeRedesignModal(): void {
    this.isRedesignModalOpen.set(false);
    this.redesignReason.set('');
    this.activeModalTaskId.set(null);
  }

  async onSubmitRedesign(): Promise<void> {
    const taskId = this.activeModalTaskId();
    const reason = this.redesignReason().trim();
    if (!taskId || !reason) return;

    const success = await this.taskService.requestRedesign(taskId, reason);
    if (success) {
      await this.notifService.loadNotifications();
      this.closeRedesignModal();
      if (this.isReviewModalOpen()) {
        this.closeReviewModal();
      }
    }
  }

  getActiveRedesignTask(): Task | null {
    const id = this.activeModalTaskId();
    if (!id) return this.taskService.selectedTask();
    return this.taskService.tasks().find((t) => t.id === id) || this.taskService.selectedTask();
  }

  appendRedesignFeedback(snippet: string): void {
    const current = this.redesignReason().trim();
    const cleanSnippet = snippet.replace(/^[•\-\*]\s*/, '').trim();
    const bulletText = `• ${cleanSnippet}`;
    const newVal = current ? `${current}\n${bulletText}` : bulletText;
    this.redesignReason.set(newVal);
  }

  onRedesignKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      const textarea = event.target as HTMLTextAreaElement;
      const { selectionStart, selectionEnd, value } = textarea;
      const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
      const currentLine = value.substring(lineStart, selectionStart);
      if (currentLine.startsWith('• ') || currentLine.startsWith('- ')) {
        event.preventDefault();
        if (currentLine.trim() === '•' || currentLine.trim() === '-') {
          const newValue = value.substring(0, lineStart) + value.substring(selectionEnd);
          this.redesignReason.set(newValue);
          setTimeout(() => {
            textarea.selectionStart = textarea.selectionEnd = lineStart;
          }, 0);
          return;
        }
        const insert = '\n• ';
        const newValue = value.substring(0, selectionStart) + insert + value.substring(selectionEnd);
        this.redesignReason.set(newValue);
        setTimeout(() => {
          textarea.selectionStart = textarea.selectionEnd = selectionStart + insert.length;
        }, 0);
      }
    }
  }

  getActiveUploadTask(): Task | null {
    const id = this.activeModalTaskId();
    if (!id) return this.taskService.selectedTask();
    return this.taskService.tasks().find((t) => t.id === id) || this.taskService.selectedTask();
  }

  formatFileSize(bytes: number | undefined): string {
    if (!bytes || bytes === 0) return '0 KB';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  parseBulletPoints(text: string | null | undefined): string[] {
    if (!text) return [];
    let clean = String(text).trim();
    while ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith("'") && clean.endsWith("'"))) {
      clean = clean.slice(1, -1).trim();
    }
    if (!clean) return [];

    let rawParts: string[] = [];
    if (clean.includes('\n')) {
      rawParts = clean.split('\n');
    } else if (clean.includes('•')) {
      rawParts = clean.split('•');
    } else {
      rawParts = [clean];
    }

    const items: string[] = [];
    for (const part of rawParts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      if (trimmed.includes('•')) {
        const sub = trimmed.split('•').map((s) => s.trim()).filter(Boolean);
        items.push(...sub);
      } else {
        const cleanedItem = trimmed.replace(/^[\-\*]\s*/, '').trim();
        if (cleanedItem) items.push(cleanedItem);
      }
    }

    return items.length > 0 ? items : [clean];
  }

  appendChangelog(snippet: string): void {
    const current = (this.uploadForm.get('changelog')?.value || '').trim();
    const cleanSnippet = snippet.replace(/^[•\-\*]\s*/, '').trim();
    const bulletText = `• ${cleanSnippet}`;
    const newVal = current ? `${current}\n${bulletText}` : bulletText;
    this.uploadForm.patchValue({ changelog: newVal });
  }

  onChangelogKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      const textarea = event.target as HTMLTextAreaElement;
      const { selectionStart, selectionEnd, value } = textarea;
      const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
      const currentLine = value.substring(lineStart, selectionStart);
      if (currentLine.startsWith('• ') || currentLine.startsWith('- ')) {
        event.preventDefault();
        if (currentLine.trim() === '•' || currentLine.trim() === '-') {
          const newValue = value.substring(0, lineStart) + value.substring(selectionEnd);
          this.uploadForm.patchValue({ changelog: newValue });
          setTimeout(() => {
            textarea.selectionStart = textarea.selectionEnd = lineStart;
          }, 0);
          return;
        }
        const insert = '\n• ';
        const newValue = value.substring(0, selectionStart) + insert + value.substring(selectionEnd);
        this.uploadForm.patchValue({ changelog: newValue });
        setTimeout(() => {
          textarea.selectionStart = textarea.selectionEnd = selectionStart + insert.length;
        }, 0);
      }
    }
  }

  triggerFileInput(): void {
    const el = document.getElementById('designerCreativeFileInput') as HTMLInputElement;
    if (el) el.click();
  }

  clearSelectedFile(): void {
    this.selectedFileObject.set(null);
    this.selectedFileDataUrl.set('');
    this.selectedFileContent.set('');
    this.uploadForm.patchValue({
      fileName: '',
      fileSizeMb: 0,
    });
    const el = document.getElementById('designerCreativeFileInput') as HTMLInputElement;
    if (el) el.value = '';
  }

  openUploadModal(task: Task): void {
    this.activeModalTaskId.set(task.id);
    this.selectedFileObject.set(null);
    this.selectedFileDataUrl.set('');
    this.selectedFileContent.set('');
    this.uploadForm.reset({
      fileName: '',
      changelog: '',
      fileSizeMb: 0,
    });
    const el = document.getElementById('designerCreativeFileInput') as HTMLInputElement;
    if (el) el.value = '';
    this.isUploadModalOpen.set(true);
  }

  closeUploadModal(): void {
    this.isUploadModalOpen.set(false);
    this.activeModalTaskId.set(null);
    this.selectedFileObject.set(null);
    this.selectedFileDataUrl.set('');
    this.selectedFileContent.set('');
  }

  async onSubmitUpload(): Promise<void> {
    if (this.uploadForm.invalid) return;

    const taskId = this.activeModalTaskId();
    if (!taskId) return;

    const { fileName, changelog, fileSizeMb } = this.uploadForm.value;
    const dataUrl = this.selectedFileDataUrl();
    const fileContent = this.selectedFileContent();

    const success = await this.taskService.submitDesign(taskId, {
      fileName,
      changelog,
      fileSize: Math.round((fileSizeMb || 2) * 1024 * 1024),
      filePath: dataUrl || `/uploads/creatives/${fileName}`,
      fileContent: fileContent || changelog,
    });

    if (success) {
      await this.notifService.loadNotifications();
      this.closeUploadModal();
    }
  }

  openReviewModal(task: Task, defaultAction: 'APPROVE' | 'REVISE' = 'APPROVE'): void {
    if (defaultAction === 'REVISE') {
      this.openRedesignModal(task);
      return;
    }
    this.activeModalTaskId.set(task.id);
    this.reviewForm.reset({
      action: defaultAction,
      remark: '',
    });
    this.isReviewModalOpen.set(true);
  }

  closeReviewModal(): void {
    this.isReviewModalOpen.set(false);
    this.activeModalTaskId.set(null);
  }

  async onSubmitReview(): Promise<void> {
    if (this.reviewForm.invalid) return;
    const taskId = this.activeModalTaskId();
    if (!taskId) return;

    const { action, remark } = this.reviewForm.value;
    if (action === 'APPROVE') {
      const success = await this.taskService.approveTask(taskId);
      if (success) {
        await this.notifService.loadNotifications();
        this.closeReviewModal();
      }
    } else {
      const success = await this.taskService.requestRedesign(taskId, remark || 'Please update design layout and spacing.');
      if (success) {
        await this.notifService.loadNotifications();
        this.closeReviewModal();
      }
    }
  }

  onTaskBriefFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      this.createdBriefFile.set(file);
      this.createdBriefFileName.set('');

      const reader = new FileReader();
      reader.onload = (e: ProgressEvent<FileReader>) => {
        this.createdBriefDataUrl.set((e.target?.result as string) || '');
      };
      reader.readAsDataURL(file);

      if (
        file.type.startsWith('text/') ||
        file.name.endsWith('.txt') ||
        file.name.endsWith('.json') ||
        file.name.endsWith('.md') ||
        file.name.endsWith('.csv') ||
        file.name.endsWith('.html') ||
        file.name.endsWith('.doc') ||
        file.name.endsWith('.docx')
      ) {
        const textReader = new FileReader();
        textReader.onload = (e: ProgressEvent<FileReader>) => {
          this.createdBriefContent.set((e.target?.result as string) || '');
        };
        textReader.readAsText(file);
      } else {
        this.createdBriefContent.set(`Document File: ${file.name}\nFile Size: ${(file.size / 1024).toFixed(1)} KB\nFile Type: ${file.type || 'Binary'}`);
      }
    }
  }

  openCreateTaskModal(preselectedDesignerId?: string): void {
    this.createdBriefFile.set(null);
    this.createdBriefFileName.set('');
    this.createdBriefDataUrl.set('');
    this.createdBriefContent.set('');
    const targetDesigner = preselectedDesignerId || this.selectedDesignerId() || (this.realDesignersList()[0]?.id || '');
    this.createTaskForm.reset({
      title: '',
      description: '',
      packageName: this.packageFilterSignal() || 'Careermate',
      assignedTo: targetDesigner,
      priority: 'HIGH',
      dueDate: new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0],
    });
    this.isCreateTaskModalOpen.set(true);
  }

  closeCreateTaskModal(): void {
    this.isCreateTaskModalOpen.set(false);
    this.createdBriefFile.set(null);
    this.createdBriefFileName.set('');
    this.createdBriefDataUrl.set('');
    this.createdBriefContent.set('');
  }

  async onSubmitCreateTask(): Promise<void> {
    if (this.createTaskForm.invalid) {
      this.createTaskForm.markAllAsTouched();
      return;
    }
    const formVal = this.createTaskForm.value;
    const fileName = this.createdBriefFileName();
    const dataUrl = this.createdBriefDataUrl();
    const fileContent = this.createdBriefContent();
    const currentUser = this.authService.currentUser();
    const selectedDesigner = this.realDesignersList().find((d) => d.id === formVal.assignedTo);
    const targetPkg = formVal.packageName || this.packageFilterSignal() || 'Careermate';

    const currentUserId = currentUser?.id || '1';
    const currentUserName = currentUser?.fullName || (currentUser?.role === 'BDM' ? 'Business Development Manager' : 'System Administrator');
    const currentUserRole = currentUser?.role || 'ADMINISTRATOR';
    const currentUserEmail = currentUser?.email || (currentUser?.role === 'BDM' ? 'bdm@markops.io' : 'admin@markops.io');

    const payload = {
      ...formVal,
      packageName: targetPkg,
      creatorId: currentUserId,
      creatorName: currentUserName,
      creatorRole: currentUserRole,
      creatorEmail: currentUserEmail,
      assigneeName: selectedDesigner ? selectedDesigner.name : 'Assigned Designer',
      attachmentName: fileName || (this.createdBriefFile() ? this.createdBriefFile()!.name : ''),
      attachmentUrl: dataUrl || (fileName ? `/uploads/briefs/${fileName}` : ''),
      content: fileContent || formVal.description || `Task brief details and specifications for ${targetPkg} package.`,
    };

    const created = await this.taskService.createTask(payload);
    if (created) {
      await this.notifService.loadNotifications();
      this.closeCreateTaskModal();
      this.switchTaskView('my');
    }
  }

  getStatusBadgeClass(status: TaskStatus): string {
    switch (status) {
      case 'DRAFT': return 'badge-secondary';
      case 'ASSIGNED': return 'badge-info';
      case 'ACCEPTED': return 'badge-info';
      case 'IN_PROGRESS': return 'badge-warning';
      case 'SUBMITTED':
      case 'RESUBMITTED':
      case 'UNDER_REVIEW': return 'badge-primary';
      case 'REVISION_REQUIRED': return 'badge-danger';
      case 'APPROVED':
      case 'PUBLISHED':
      case 'COMPLETED': return 'badge-success';
      default: return 'badge-secondary';
    }
  }

  getPriorityBadgeClass(priority: TaskPriority): string {
    switch (priority) {
      case 'LOW': return 'priority-low';
      case 'MEDIUM': return 'priority-medium';
      case 'HIGH': return 'priority-high';
      case 'URGENT': return 'priority-urgent';
      default: return '';
    }
  }

  getAssigneeName(task: Task | null): string {
    if (!task) return 'Unassigned';
    if (task.assigneeName && task.assigneeName !== 'Assigned User') {
      return task.assigneeName;
    }
    if (task.assignedTo) {
      const assignedToStr = String(task.assignedTo);
      const userList = this.userService.users();
      const match = userList.find((u) => String(u.id) === assignedToStr);
      if (match) return match.fullName;
    }
    return task.assigneeName || 'Designer';
  }

  getCreatorName(task: Task | null): string {
    if (!task) return 'Manager';
    if (task.creatorName && task.creatorName !== 'Manager') {
      return task.creatorName;
    }
    if (task.createdBy) {
      const createdByStr = String(task.createdBy);
      const userList = this.userService.users();
      const match = userList.find((u) => String(u.id) === createdByStr);
      if (match) return match.fullName;
    }
    return task.creatorName || 'Manager';
  }

  getCreatorRoleLabel(task: Task | null): string {
    if (!task) return 'Manager';
    const role = task.creatorRole || 'ADMINISTRATOR';
    switch (role.toUpperCase()) {
      case 'ADMINISTRATOR': return 'Administrator';
      case 'MARKETING_MANAGER': return 'Marketing Manager';
      case 'BDM': return 'BDM';
      default: return role;
    }
  }

  isPdf(nameOrUrl: string): boolean {
    if (!nameOrUrl) return false;
    const lower = nameOrUrl.toLowerCase();
    return lower.endsWith('.pdf') || lower.includes('.pdf') || lower.includes('pdf');
  }

  downloadRequirementFile(task: Task, event?: Event): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    const fileName = task.attachmentName || `${(task.title || 'requirement_document').toLowerCase().replace(/[^a-z0-9]/g, '-')}.png`;
    const url = task.attachmentUrl;
    if (url && url !== '#') {
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      const content = task.content || task.description || `Task: ${task.title}\nPackage: ${task.packageName || ''}\nDescription: ${task.description || ''}`;
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = fileName.endsWith('.txt') || fileName.endsWith('.pdf') || fileName.endsWith('.png') ? fileName : `${fileName}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    }
  }

  viewTask(event: Event, task: Task): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    this.taskService.closeTaskDetail();
    this.router.navigate(['/tasks', task.id], {
      queryParams: { returnUrl: this.router.url },
    });
  }

  readonly activeDetailTab = signal<'DETAIL' | 'VERSIONS' | 'HISTORY'>('DETAIL');

  getWorkflowSteps(task: Task) {
    const status = task.status;
    const versionCount = task.versions?.length || 0;

    let stage1State: 'completed' | 'current' | 'upcoming' = 'completed';
    let stage2State: 'completed' | 'current' | 'upcoming' = 'upcoming';
    let stage3State: 'completed' | 'current' | 'upcoming' = 'upcoming';
    let stage4State: 'completed' | 'current' | 'upcoming' | 'revision' = 'upcoming';

    if (status === 'DRAFT' || status === 'ASSIGNED') {
      stage1State = 'current';
    } else if (status === 'ACCEPTED' || status === 'IN_PROGRESS') {
      stage1State = 'completed';
      stage2State = 'current';
    } else if (status === 'SUBMITTED' || status === 'RESUBMITTED' || status === 'UNDER_REVIEW') {
      stage1State = 'completed';
      stage2State = 'completed';
      stage3State = 'current';
    } else if (status === 'REVISION_REQUIRED') {
      stage1State = 'completed';
      stage2State = 'completed';
      stage3State = 'completed';
      stage4State = 'revision';
    } else if (status === 'APPROVED' || status === 'PUBLISHED' || status === 'COMPLETED') {
      stage1State = 'completed';
      stage2State = 'completed';
      stage3State = 'completed';
      stage4State = 'completed';
    }

    return [
      {
        id: 1,
        title: 'Task Assigned',
        subtitle: status === 'ASSIGNED' ? 'Awaiting Acceptance' : 'Brief Received',
        icon: 'assignment_turned_in',
        state: stage1State,
      },
      {
        id: 2,
        title: 'Started',
        subtitle: status === 'IN_PROGRESS' ? 'Active Creative Work' : status === 'ACCEPTED' ? 'Task Accepted' : stage2State === 'completed' ? 'Canvas Complete' : 'Pending Start',
        icon: 'palette',
        state: stage2State,
      },
      {
        id: 3,
        title: 'Under Review',
        subtitle: versionCount > 0 ? `v${versionCount}.0 Submitted` : 'Awaiting Version',
        icon: 'unarchive',
        state: stage3State,
      },
      {
        id: 4,
        title: stage4State === 'revision' ? 'Revision Needed' : 'Completed',
        subtitle: stage4State === 'completed' ? 'Approved & Ready' : stage4State === 'revision' ? 'Feedback Requested' : 'Pending Review',
        icon: stage4State === 'revision' ? 'rate_review' : 'verified',
        state: stage4State,
      },
    ];
  }

  getHistoryNodeIcon(newStatus: TaskStatus): string {
    switch (newStatus) {
      case 'ASSIGNED': return 'assignment';
      case 'ACCEPTED': return 'task_alt';
      case 'IN_PROGRESS': return 'draw';
      case 'SUBMITTED':
      case 'RESUBMITTED': return 'upload_file';
      case 'UNDER_REVIEW': return 'find_in_page';
      case 'REVISION_REQUIRED': return 'rate_review';
      case 'APPROVED':
      case 'PUBLISHED':
      case 'COMPLETED': return 'verified';
      default: return 'history';
    }
  }

  getHistoryNodeClass(newStatus: TaskStatus): string {
    switch (newStatus) {
      case 'ACCEPTED':
      case 'APPROVED':
      case 'PUBLISHED':
      case 'COMPLETED': return 'node-success';
      case 'REVISION_REQUIRED': return 'node-danger';
      case 'SUBMITTED':
      case 'RESUBMITTED':
      case 'UNDER_REVIEW': return 'node-primary';
      case 'IN_PROGRESS': return 'node-warning';
      default: return 'node-info';
    }
  }

  readonly commitMessage = signal<string>('');
  readonly isSubmittingCommit = signal<boolean>(false);

  formatCommitDate(isoDate?: string): string {
    if (!isoDate) return '';
    try {
      const d = new Date(isoDate);
      return d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      return isoDate;
    }
  }

  generateShortHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    const hex = Math.abs(hash).toString(16).padStart(6, '0');
    return hex.substring(0, 6);
  }

  getRolePrefix(role?: string): string {
    const r = String(role || '').toUpperCase();
    if (r.includes('ADMIN')) return 'Admin';
    if (r.includes('BDM')) return 'BDM';
    if (r.includes('MARKETING') || r.includes('MANAGER')) return 'Manager';
    if (r.includes('DESIGNER')) return 'Designer';
    return role || 'User';
  }

  getRoleClass(role?: string): string {
    const r = String(role || '').toUpperCase();
    if (r.includes('ADMIN')) return 'role-admin';
    if (r.includes('BDM')) return 'role-bdm';
    if (r.includes('MARKETING') || r.includes('MANAGER')) return 'role-mktg';
    if (r.includes('DESIGNER')) return 'role-designer';
    return 'role-default';
  }

  getGitCommitTimeline(task: Task) {
    const nodes: {
      id: string;
      hash: string;
      authorLabel: string;
      authorRole: string;
      authorRoleClass: string;
      message: string;
      bulletPoints?: string[];
      type: 'INIT' | 'STATUS' | 'VERSION' | 'COMMENT' | 'REVISION' | 'APPROVED';
      badge: string;
      badgeClass: string;
      nodeClass: string;
      createdAt: string;
      relativeTime: string;
      fileUrl?: string;
      fileName?: string;
      fileContent?: string;
      versionNumber?: number;
    }[] = [];

    const creatorName = this.getCreatorName(task);
    const creatorRole = task.creatorRole || 'ADMINISTRATOR';
    const assigneeName = this.getAssigneeName(task);

    const hasInitialHistory = task.statusHistory && task.statusHistory.some((h) => !h.previousStatus || h.newStatus === 'ASSIGNED' || String(h.remark).toLowerCase().includes('task created'));

    // 1. Initial Commit (Task Created & Assigned)
    if (!hasInitialHistory) {
      nodes.push({
        id: `init_${task.id}`,
        hash: this.generateShortHash(`init_${task.id}_${task.createdAt}`),
        authorLabel: `${this.getRolePrefix(creatorRole)}(${creatorName})`,
        authorRole: creatorRole,
        authorRoleClass: this.getRoleClass(creatorRole),
        message: task.description
          ? `Created task "${task.title}": "${task.description}" (Assigned to ${assigneeName})`
          : `Created and assigned task "${task.title}" to ${assigneeName}`,
        type: 'INIT',
        badge: 'ASSIGNED',
        badgeClass: 'badge-init',
        nodeClass: 'git-node-init',
        createdAt: task.createdAt || new Date().toISOString(),
        relativeTime: this.formatCommitDate(task.createdAt),
        fileUrl: task.attachmentUrl,
        fileName: task.attachmentName,
        fileContent: task.content,
      });
    }

    // 2. Status History Transitions
    if (task.statusHistory && task.statusHistory.length > 0) {
      for (const h of task.statusHistory) {
        if (!h.newStatus) continue;

        // Skip duplicate version history entries if versions list already has it
        const remarkStr = String(h.remark || '').toLowerCase();
        if (remarkStr.includes('uploaded creative version') && task.versions && task.versions.length > 0) {
          continue;
        }

        let actorName = h.actorName;
        let actorRole = (h.actorRole || '').toUpperCase();

        const isDesignerAction = h.newStatus === 'IN_PROGRESS' || h.newStatus === 'ACCEPTED' || h.newStatus === 'SUBMITTED' || h.newStatus === 'RESUBMITTED' || remarkStr.includes('accepted') || remarkStr.includes('started');
        const isCreatorAction = h.newStatus === 'REVISION_REQUIRED' || h.newStatus === 'APPROVED' || h.newStatus === 'ASSIGNED' || !h.previousStatus || remarkStr.includes('task created');

        if (isDesignerAction) {
          actorRole = 'DESIGNER';
          actorName = assigneeName || actorName || 'Designer';
        } else if (isCreatorAction) {
          actorRole = creatorRole;
          actorName = creatorName || actorName || 'Manager';
        } else {
          actorName = actorName || creatorName;
          actorRole = actorRole || creatorRole;
        }

        const rolePrefix = this.getRolePrefix(actorRole);

        let type: 'STATUS' | 'REVISION' | 'APPROVED' = 'STATUS';
        let badgeClass = 'badge-info';
        let nodeClass = 'git-node-info';
        let badgeLabel: string = h.newStatus;

        if (h.newStatus === 'REVISION_REQUIRED') {
          type = 'REVISION';
          badgeClass = 'badge-danger';
          nodeClass = 'git-node-danger';
          badgeLabel = 'REDESIGN REQUIRED';
        } else if (h.newStatus === 'APPROVED' || h.newStatus === 'COMPLETED' || h.newStatus === 'PUBLISHED') {
          type = 'APPROVED';
          badgeClass = 'badge-success';
          nodeClass = 'git-node-success';
          badgeLabel = 'APPROVED';
        } else if (h.newStatus === 'IN_PROGRESS') {
          badgeClass = 'badge-warning';
          nodeClass = 'git-node-warning';
          badgeLabel = 'IN PROCESS';
        } else if (h.newStatus === 'ACCEPTED') {
          badgeClass = 'badge-primary';
          nodeClass = 'git-node-primary';
          badgeLabel = 'ACCEPTED';
        } else if (h.newStatus === 'ASSIGNED') {
          badgeClass = 'badge-init';
          nodeClass = 'git-node-init';
          badgeLabel = 'ASSIGNED';
        } else if (h.newStatus === 'SUBMITTED' || h.newStatus === 'RESUBMITTED' || h.newStatus === 'UNDER_REVIEW') {
          badgeClass = 'badge-version';
          nodeClass = 'git-node-cyan';
          badgeLabel = 'UNDER REVIEW';
        }

        const fallbackRemark = h.newStatus === 'REVISION_REQUIRED'
          ? `Requested Redesign / Revision: "${task.reviewerFeedback || h.remark || 'Please update design as per specifications'}"`
          : (h.remark || `Updated status to ${badgeLabel}`);

        const rawRemark = h.remark || fallbackRemark;
        let messageText = rawRemark;
        let bullets: string[] = [];

        const uploadMatch = rawRemark.match(/^Uploaded version (v\d+\.\d+.*?):\s*"?([\s\S]*?)"?$/i);
        if (uploadMatch) {
          messageText = `Uploaded version ${uploadMatch[1]}:`;
          bullets = this.parseBulletPoints(uploadMatch[2]);
        } else if (rawRemark.includes('•')) {
          const leadMatch = rawRemark.match(/^([^•]+?):\s*([\s\S]*)$/);
          if (leadMatch) {
            messageText = leadMatch[1] + ':';
            bullets = this.parseBulletPoints(leadMatch[2]);
          } else {
            bullets = this.parseBulletPoints(rawRemark);
            messageText = '';
          }
        }

        nodes.push({
          id: h.id || `hist_${Math.random()}`,
          hash: this.generateShortHash(`hist_${h.id || h.createdAt}`),
          authorLabel: `${rolePrefix}(${actorName})`,
          authorRole: actorRole,
          authorRoleClass: this.getRoleClass(actorRole),
          message: messageText,
          bulletPoints: bullets,
          type,
          badge: badgeLabel,
          badgeClass,
          nodeClass,
          createdAt: h.createdAt || new Date().toISOString(),
          relativeTime: this.formatCommitDate(h.createdAt),
        });
      }
    }

    // 3. Creative Version Uploads
    if (task.versions && task.versions.length > 0) {
      for (const v of task.versions) {
        const authorName = assigneeName || v.submittedByName || 'Designer';
        const authorRole = 'DESIGNER';
        const rolePrefix = 'Designer';

        const verBullets = this.parseBulletPoints(v.changelog);
        const verMessage = verBullets.length > 0
          ? `Uploaded version v${v.versionNumber}.0 (${v.fileName}):`
          : `Uploaded design asset v${v.versionNumber}.0 (${v.fileName})`;

        nodes.push({
          id: v.id || `ver_${v.versionNumber}`,
          hash: this.generateShortHash(`ver_${v.id || v.versionNumber}_${v.createdAt}`),
          authorLabel: `${rolePrefix}(${authorName})`,
          authorRole,
          authorRoleClass: this.getRoleClass(authorRole),
          message: verMessage,
          bulletPoints: verBullets,
          type: 'VERSION',
          badge: `v${v.versionNumber}.0 UNDER REVIEW`,
          badgeClass: 'badge-version',
          nodeClass: 'git-node-cyan',
          createdAt: v.createdAt || new Date().toISOString(),
          relativeTime: this.formatCommitDate(v.createdAt),
          fileUrl: v.filePath,
          fileName: v.fileName,
          fileContent: v.fileContent || v.changelog,
          versionNumber: v.versionNumber,
        });
      }
    }

    // 4. Comments / Communication Messages
    if (task.comments && task.comments.length > 0) {
      for (const c of task.comments) {
        let authorName = c.userName || 'Team Member';
        let authorRole = (c.userRole || '').toUpperCase();

        if (authorName.toLowerCase() === assigneeName.toLowerCase() || authorRole.includes('DESIGN')) {
          authorRole = 'DESIGNER';
          authorName = assigneeName;
        } else if (authorName.toLowerCase() === creatorName.toLowerCase() || authorRole.includes('ADMIN') || authorRole.includes('BDM')) {
          authorRole = creatorRole;
          authorName = creatorName;
        }

        const rolePrefix = this.getRolePrefix(authorRole);

        nodes.push({
          id: c.id || `comm_${Math.random()}`,
          hash: this.generateShortHash(`comm_${c.id || c.createdAt}`),
          authorLabel: `${rolePrefix}(${authorName})`,
          authorRole,
          authorRoleClass: this.getRoleClass(authorRole),
          message: c.comment,
          type: 'COMMENT',
          badge: 'COMMIT MSG',
          badgeClass: 'badge-comment',
          nodeClass: 'git-node-purple',
          createdAt: c.createdAt || new Date().toISOString(),
          relativeTime: this.formatCommitDate(c.createdAt),
        });
      }
    }

    // Sort chronologically (earliest first -> newest commit at bottom)
    nodes.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    return nodes;
  }

  async onSendCommitMessage(taskId: string): Promise<void> {
    const text = this.commitMessage().trim();
    if (!text || !taskId) return;

    this.isSubmittingCommit.set(true);
    const currentUser = this.authService.currentUser();

    const success = await this.taskService.addComment(taskId, text, {
      userId: currentUser?.id ? String(currentUser.id) : undefined,
      userName: currentUser?.fullName || 'User',
      userRole: currentUser?.role || 'ADMINISTRATOR',
    });

    this.isSubmittingCommit.set(false);
    if (success) {
      this.commitMessage.set('');
    }
  }

  readonly timelineSortOrder = signal<'latest' | 'oldest'>('oldest');
  readonly isSidePanelMenuOpen = signal<boolean>(false);
  readonly showVersionsInline = signal<boolean>(false);

  toggleTimelineSortOrder(): void {
    this.timelineSortOrder.update((v) => (v === 'latest' ? 'oldest' : 'latest'));
  }

  toggleSidePanelMenu(): void {
    this.isSidePanelMenuOpen.update((v) => !v);
  }

  toggleVersionsView(): void {
    this.showVersionsInline.update((v) => !v);
  }

  getSortedGitTimeline(task: Task) {
    const list = this.getGitCommitTimeline(task);
    if (this.timelineSortOrder() === 'latest') {
      return [...list].reverse();
    }
    return list;
  }

  async deleteTask(event: Event, task: Task): Promise<void> {
    event.stopPropagation();
    if (!this.canDeleteTask(task)) {
      alert('Permission Denied: You can only delete tasks created by you.');
      return;
    }
    if (confirm(`Are you sure you want to delete task "${task.title}"? This action is permanent and cannot be undone.`)) {
      const success = await this.taskService.deleteTask(task.id);
      if (!success) {
        alert(this.taskService.error() || 'Failed to delete task.');
      }
    }
  }
}
