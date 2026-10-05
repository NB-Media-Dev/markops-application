import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { roleGuard } from './core/guards/role.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () =>
      import('./features/auth/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./core/layout/main-layout.component').then((m) => m.MainLayoutComponent),
    children: [
      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full',
      },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
        data: { title: 'Dashboard', icon: 'dashboard' },
      },
      {
        path: 'package-works',
        loadComponent: () =>
          import('./features/package-works/package-works.component').then((m) => m.PackageWorksComponent),
        data: { title: 'Package Works', icon: 'inventory_2' },
      },
      {
        path: 'tasks',
        canActivate: [roleGuard],
        data: { title: 'Tasks', icon: 'task_alt', roles: ['ADMINISTRATOR', 'MARKETING_MANAGER', 'BDM'] },
        loadComponent: () =>
          import('./features/designer/designer-dashboard.component').then((m) => m.DesignerDashboardComponent),
      },
      {
        path: 'tasks/:id',
        canActivate: [roleGuard],
        data: { title: 'Task Details', icon: 'task_alt' },
        loadComponent: () =>
          import('./features/designer/task-detail/task-detail.component').then((m) => m.TaskDetailComponent),
      },
      {
        path: 'designers',
        loadComponent: () =>
          import('./features/performance/performance.component').then((m) => m.PerformanceComponent),
        data: { title: 'Designers', icon: 'palette' },
      },
      {
        path: 'campaigns',
        canActivate: [roleGuard],
        data: { title: 'Campaigns', icon: 'campaign', roles: ['ADMINISTRATOR', 'MARKETING_MANAGER', 'DIGITAL_MARKETING'] },
        loadComponent: () =>
          import('./features/campaigns/campaigns.component').then((m) => m.CampaignsComponent),
      },
      {
        path: 'targets',
        canActivate: [roleGuard],
        data: { title: 'Targets', icon: 'track_changes', roles: ['ADMINISTRATOR', 'MARKETING_MANAGER'] },
        loadComponent: () =>
          import('./features/targets/targets.component').then((m) => m.TargetsComponent),
      },
      {
        path: 'ads',
        canActivate: [roleGuard],
        data: { title: 'Ads', icon: 'ads_click', roles: ['ADMINISTRATOR', 'MARKETING_MANAGER', 'DIGITAL_MARKETING'] },
        loadComponent: () =>
          import('./features/ads/ads.component').then((m) => m.AdsComponent),
      },
      {
        path: 'ad-metrics',
        canActivate: [roleGuard],
        data: { title: 'Ad Metrics', icon: 'query_stats', roles: ['ADMINISTRATOR', 'MARKETING_MANAGER', 'DIGITAL_MARKETING'] },
        loadComponent: () =>
          import('./features/ads/ads.component').then((m) => m.AdsComponent),
      },
      {
        path: 'leads',
        loadComponent: () =>
          import('./features/leads/leads.component').then((m) => m.LeadsComponent),
        data: { title: 'Leads', icon: 'contacts' },
      },
      {
        path: 'lead-source',
        loadComponent: () =>
          import('./features/leads/leads.component').then((m) => m.LeadsComponent),
        data: { title: 'Lead Source', icon: 'share' },
      },
      {
        path: 'assigned-leads',
        loadComponent: () =>
          import('./features/leads/leads.component').then((m) => m.LeadsComponent),
        data: { title: 'Assigned Leads', icon: 'assignment_ind' },
      },
      {
        path: 'telecalling',
        loadComponent: () =>
          import('./features/telecalling/telecalling.component').then((m) => m.TelecallingComponent),
        data: { title: 'Telecalling', icon: 'phone_in_talk' },
      },
      {
        path: 'calls',
        loadComponent: () =>
          import('./features/telecalling/telecalling.component').then((m) => m.TelecallingComponent),
        data: { title: 'Calls', icon: 'phone_in_talk' },
      },
      {
        path: 'follow-ups',
        loadComponent: () =>
          import('./features/telecalling/telecalling.component').then((m) => m.TelecallingComponent),
        data: { title: 'Follow-ups', icon: 'event_repeat' },
      },
      {
        path: 'qualification',
        loadComponent: () =>
          import('./features/telecalling/telecalling.component').then((m) => m.TelecallingComponent),
        data: { title: 'Qualification', icon: 'verified' },
      },
      {
        path: 'outcomes',
        loadComponent: () =>
          import('./features/telecalling/telecalling.component').then((m) => m.TelecallingComponent),
        data: { title: 'Outcomes', icon: 'done_all' },
      },

      {
        path: 'transactions',
        loadComponent: () =>
          import('./features/transactions/transactions.component').then((m) => m.TransactionsComponent),
        data: { title: 'Transactions', icon: 'receipt_long' },
      },
      {
        path: 'transaction-workflow',
        loadComponent: () =>
          import('./features/transactions/transactions.component').then((m) => m.TransactionsComponent),
        data: { title: 'Transaction Workflow', icon: 'receipt_long' },
      },
      {
        path: 'reports',
        loadComponent: () =>
          import('./features/reports/reports.component').then((m) => m.ReportsComponent),
        data: { title: 'Reports', icon: 'bar_chart' },
      },
      {
        path: 'performance',
        loadComponent: () =>
          import('./features/performance/performance.component').then((m) => m.PerformanceComponent),
        data: { title: 'Performance', icon: 'trending_up' },
      },
      {
        path: 'achievements',
        loadComponent: () =>
          import('./features/performance/performance.component').then((m) => m.PerformanceComponent),
        data: { title: 'Achievements', icon: 'emoji_events' },
      },
      {
        path: 'users-roles',
        canActivate: [roleGuard],
        data: { roles: ['ADMINISTRATOR'], title: 'Users & Roles', icon: 'manage_accounts' },
        loadComponent: () =>
          import('./features/users-roles/users-roles.component').then((m) => m.UsersRolesComponent),
      },
      {
        path: 'audit-logs',
        canActivate: [roleGuard],
        data: { title: 'Audit Logs', icon: 'history', roles: ['ADMINISTRATOR', 'MARKETING_MANAGER', 'BDM'] },
        loadComponent: () =>
          import('./features/audit-logs/audit-logs.component').then((m) => m.AuditLogsComponent),
      },
      {
        path: 'downloads',
        loadComponent: () =>
          import('./features/downloads/downloads.component').then((m) => m.DownloadsComponent),
        data: { title: 'Downloads', icon: 'download' },
      },
      {
        path: 'notifications',
        loadComponent: () =>
          import('./features/notifications/notifications.component').then((m) => m.NotificationsComponent),
        data: { title: 'Notifications', icon: 'notifications' },
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./features/settings/settings.component').then((m) => m.SettingsComponent),
        data: { title: 'Settings', icon: 'settings' },
      },
      {
        path: 'integrations',
        loadComponent: () =>
          import('./features/settings/settings.component').then((m) => m.SettingsComponent),
        data: { title: 'Integrations', icon: 'hub' },
      },
      {
        path: 'designer-tasks',
        loadComponent: () =>
          import('./features/designer/designer-dashboard.component').then((m) => m.DesignerDashboardComponent),
        data: { title: 'Own Tasks', icon: 'task_alt' },
      },
      {
        path: 'designer-tasks/:id',
        canActivate: [roleGuard],
        data: { title: 'Task Details', icon: 'task_alt' },
        loadComponent: () =>
          import('./features/designer/task-detail/task-detail.component').then((m) => m.TaskDetailComponent),
      },
      {
        path: 'submissions',
        loadComponent: () =>
          import('./features/designer/designer-dashboard.component').then((m) => m.DesignerDashboardComponent),
        data: { title: 'Submissions', icon: 'upload_file' },
      },
      {
        path: 'revisions',
        loadComponent: () =>
          import('./features/designer/designer-dashboard.component').then((m) => m.DesignerDashboardComponent),
        data: { title: 'Revisions', icon: 'edit_note' },
      },
      {
        path: 'comments',
        loadComponent: () =>
          import('./features/designer/designer-dashboard.component').then((m) => m.DesignerDashboardComponent),
        data: { title: 'Comments', icon: 'chat' },
      },
      {
        path: 'files',
        loadComponent: () =>
          import('./features/designer/designer-dashboard.component').then((m) => m.DesignerDashboardComponent),
        data: { title: 'Files', icon: 'folder' },
      },
    ],
  },
  {
    path: '**',
    redirectTo: 'dashboard',
  },
];
