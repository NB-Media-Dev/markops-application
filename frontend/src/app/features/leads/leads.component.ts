import { Component, inject, OnInit, signal, computed, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { LeadTelecallingService, LeadItem, CallActivityItem } from '../../core/services/lead-telecalling.service';
import { UserManagementService } from '../../core/services/user-management.service';
import { AuthService } from '../../core/services/auth.service';
import { CampaignService } from '../../core/services/campaign.service';
import { isLeadAssignedToUser } from '../telecalling/telecalling.component';
import { FIXED_PACKAGES } from '../../core/models/package.model';

@Component({
  selector: 'app-leads',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './leads.component.html',
  styleUrl: './leads.component.scss',
})
export class LeadsComponent implements OnInit {
  readonly packageFilterSignal = signal<string | undefined>(undefined);
  @Input() set packageFilter(val: string | undefined) {
    this.packageFilterSignal.set(val);
  }
  get packageFilter(): string | undefined {
    return this.packageFilterSignal();
  }
  @Input() embedded = false;

  readonly Math = Math;
  readonly leadService = inject(LeadTelecallingService);
  readonly userMgmtService = inject(UserManagementService);
  readonly authService = inject(AuthService);
  readonly campaignService = inject(CampaignService);

  readonly activeTab = signal<'LEADS_LIST' | 'TELECALLING_MONITOR'>('LEADS_LIST');
  readonly showModal = signal<boolean>(false);
  readonly showExcelModal = signal<boolean>(false);
  readonly filterStatus = signal<string>('ALL');
  readonly searchQuery = signal<string>('');
  readonly filterTelecaller = signal<string>('ALL');
  readonly filterCampaign = signal<string>('ALL');
  readonly currentPage = signal<number>(1);
  readonly pageSize = signal<number>(10);
  readonly pageSizeOptions: number[] = [10, 25, 50, 100];

  // Single Lead Form Fields
  newFirstName = '';
  newLastName = '';
  newEmail = '';
  newPhone = '';
  newSource = 'Digital Ads Lead Form';
  newCampaignId = '';
  newCampaignName = '';
  newAssignedTelecallerId = '';
  readonly isCreatingLead = signal<boolean>(false);

  firstNameTouched = false;
  lastNameTouched = false;
  emailTouched = false;
  phoneTouched = false;
  sourceTouched = false;


  selectedLeadForAssign: LeadItem | null = null;
  selectedUserId = '';
  assigneeName = '';

  
  campaignName = '';
  leadSource = 'Digital Ads Lead Form';
  excelRawText = '';
  selectedFileName = signal<string>('');
  parsedLeads = signal<any[]>([]);
  uploadSuccessMessage = signal<string | null>(null);
  uploadValidationError = signal<string | null>(null);
  selectedTelecallerIds = signal<string[]>([]);

  get currentPackageDisplayName(): string {
    return this.packageFilterSignal() || 'Careermate';
  }


  readonly canUploadLeads = computed(() => {
    const user = this.authService.currentUser();
    if (!user) return false;
    const role = user.role ? String(user.role).toUpperCase() : '';
    return (
      role.includes('DIGITAL') ||
      role.includes('MARKETING') ||
      role.includes('ADMIN')
    );
  });

  readonly isTelecaller = computed(() => {
    const user = this.authService.currentUser();
    return user?.role === 'TELECALLER';
  });


  readonly activeTelecallers = computed(() => {
    const list: any[] = [];
    const seen = new Set<string>();

    const users = this.userMgmtService.users().filter((u) => u.role === 'TELECALLER');
    users.forEach((u) => {
      const key = (u.fullName || '').toLowerCase().trim();
      if (key && !seen.has(key)) {
        seen.add(key);
        list.push(u);
      }
    });

    // Also include any assignees from existing leads if not already listed
    this.leadService.leads().forEach((l) => {
      const aName = (l.assigneeName || (l as any).assignee_name || '').trim();
      const aId = String(l.assignedTo || (l as any).assigned_to || '').trim();
      if (aName && aName.toLowerCase() !== 'unassigned' && !seen.has(aName.toLowerCase())) {
        seen.add(aName.toLowerCase());
        list.push({
          id: aId || aName,
          fullName: aName,
          email: '',
          role: 'TELECALLER',
          isActive: true,
        });
      }
    });

    return list;
  });

  readonly realUsersList = computed(() => this.activeTelecallers());


  readonly assignmentPreview = computed(() => {
    const totalLeads = this.parsedLeads().length;
    const selectedIds = this.selectedTelecallerIds();
    const telecallers = this.activeTelecallers().filter((tc) => selectedIds.includes(tc.id));
    const tcCount = telecallers.length;

    if (totalLeads === 0 || tcCount === 0) {
      return null;
    }

    const perTc = Math.floor(totalLeads / tcCount);
    const remainder = totalLeads % tcCount;

    const allocationList = telecallers.map((tc, index) => {
      const count = perTc + (index < remainder ? 1 : 0);
      return {
        id: tc.id,
        fullName: tc.fullName,
        count,
      };
    });

    return {
      totalLeads,
      tcCount,
      perTc,
      remainder,
      allocationList,
      formulaText: `${totalLeads} Leads ÷ ${tcCount} Telecallers = ${perTc} leads each${remainder > 0 ? ` (+1 extra for ${remainder} telecaller(s))` : ''}`,
    };
  });

  readonly availableCampaigns = computed(() => {
    const list: { id: string; name: string }[] = [];
    const seenNames = new Set<string>();

    const all = this.campaignService.campaigns();
    if (all && all.length > 0) {
      all.forEach((c) => {
        const name = (c.name || '').trim();
        if (name && !seenNames.has(name.toLowerCase())) {
          seenNames.add(name.toLowerCase());
          list.push({ id: String(c.id || name), name });
        }
      });
    }

    // Also collect distinct campaign names from loaded leads (e.g. "Exam panle")
    const allLeads = this.leadService.leads();
    allLeads.forEach((l) => {
      const name = (l.campaignName || (l as any).campaign_name || '').trim();
      if (name && !seenNames.has(name.toLowerCase())) {
        seenNames.add(name.toLowerCase());
        list.push({ id: String(l.campaignId || (l as any).campaign_id || name), name });
      }
    });

    return list;
  });

  isPhoneValid(phone: string): boolean {
    if (!phone || !phone.trim()) return false;
    const clean = phone.replace(/[\s\-\(\)\+]/g, '');
    if (clean.length === 10 && /^[6-9]\d{9}$/.test(clean)) return true;
    if (clean.length === 12 && clean.startsWith('91') && /^[6-9]\d{9}$/.test(clean.substring(2))) return true;
    if (clean.length === 11 && clean.startsWith('0') && /^[6-9]\d{9}$/.test(clean.substring(1))) return true;
    return false;
  }

  isEmailValid(email: string): boolean {
    if (!email || !email.trim()) return false;
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return emailRegex.test(email.trim());
  }

  get isAddLeadFormValid(): boolean {
    return (
      this.newFirstName.trim().length >= 2 &&
      this.newLastName.trim().length >= 1 &&
      this.isPhoneValid(this.newPhone) &&
      this.isEmailValid(this.newEmail) &&
      this.newSource.trim().length >= 2
    );
  }

  getSelectedTelecaller() {
    if (!this.newAssignedTelecallerId) return null;
    return this.activeTelecallers().find((tc) => tc.id === this.newAssignedTelecallerId) || null;
  }

  onCampaignSelectChange(event: Event) {
    const selectedVal = (event.target as HTMLSelectElement).value;
    const found = this.campaignService.campaigns().find((c) => c.id === selectedVal);
    if (found) {
      this.newCampaignId = found.id;
      this.newCampaignName = found.name;
    } else {
      this.newCampaignId = '';
      this.newCampaignName = selectedVal;
    }
  }

  onTelecallerSelectChange(event: Event) {
    const selectedId = (event.target as HTMLSelectElement).value;
    this.newAssignedTelecallerId = selectedId;
  }

  ngOnInit() {
    this.leadService.loadLeads().subscribe();
    this.leadService.loadCalls().subscribe();
    this.leadService.loadSummary().subscribe();
    this.campaignService.loadCampaigns().subscribe();

    const telecallers = this.activeTelecallers();
    if (telecallers.length > 0) {
      this.selectedTelecallerIds.set(telecallers.map((tc) => tc.id));
    }
  }

  downloadSampleCsv() {
    const headers = 'First Name,Last Name,Email,Phone,Source\n';
    const firstNames = ['Rahul', 'Priya', 'Amit', 'Sneha', 'Vikas', 'Ananya', 'Rohan', 'Kavita', 'Sanjay', 'Meera', 
                        'Arjun', 'Pooja', 'Deepak', 'Ritu', 'Karan', 'Simran', 'Nitin', 'Divya', 'Siddharth', 'Neha', 
                        'Alok', 'Tanya', 'Varun', 'Shweta', 'Gaurav', 'Preeti', 'Abhishek', 'Monika', 'Rajesh', 'Sunita'];
    const lastNames = ['Sharma', 'Verma', 'Gupta', 'Patel', 'Singh', 'Kumar', 'Joshi', 'Mehta', 'Chawla', 'Nair',
                       'Reddy', 'Rao', 'Deshmukh', 'Bhat', 'Roy', 'Sen', 'Dutta', 'Das', 'Kapoor', 'Malhotra',
                       'Khanna', 'Bhasin', 'Bansal', 'Agarwal', 'Choudhury', 'Iyer', 'Menon', 'Pillai', 'Pandey', 'Mishra'];

    let rows = '';
    for (let i = 0; i < 30; i++) {
      rows += `${firstNames[i]},${lastNames[i]},${firstNames[i].toLowerCase()}@example.com,+91 98${Math.floor(10000000 + Math.random() * 90000000)},Digital Lead Gen\n`;
    }

    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Sample_30_Leads_Upload.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  }

  loadSampleLeadsData() {
    const firstNames = ['Rahul', 'Priya', 'Amit', 'Sneha', 'Vikas', 'Ananya', 'Rohan', 'Kavita', 'Sanjay', 'Meera', 
                        'Arjun', 'Pooja', 'Deepak', 'Ritu', 'Karan', 'Simran', 'Nitin', 'Divya', 'Siddharth', 'Neha', 
                        'Alok', 'Tanya', 'Varun', 'Shweta', 'Gaurav', 'Preeti', 'Abhishek', 'Monika', 'Rajesh', 'Sunita'];
    const lastNames = ['Sharma', 'Verma', 'Gupta', 'Patel', 'Singh', 'Kumar', 'Joshi', 'Mehta', 'Chawla', 'Nair',
                       'Reddy', 'Rao', 'Deshmukh', 'Bhat', 'Roy', 'Sen', 'Dutta', 'Das', 'Kapoor', 'Malhotra',
                       'Khanna', 'Bhasin', 'Bansal', 'Agarwal', 'Choudhury', 'Iyer', 'Menon', 'Pillai', 'Pandey', 'Mishra'];

    const sampleLeads: any[] = [];
    let rawCsv = 'First Name,Last Name,Email,Phone,Source\n';
    const pkg = this.currentPackageDisplayName;
    for (let i = 0; i < 30; i++) {
      const fn = firstNames[i];
      const ln = lastNames[i];
      const email = `${fn.toLowerCase()}.${ln.toLowerCase()}@example.com`;
      const phone = `+91 98${Math.floor(10000000 + Math.random() * 90000000)}`;
      const source = `${pkg} Lead Gen`;
      sampleLeads.push({ firstName: fn, lastName: ln, email, phone, source });
      rawCsv += `${fn},${ln},${email},${phone},${source}\n`;
    }
    this.excelRawText = rawCsv;
    this.parsedLeads.set(sampleLeads);
    this.selectedFileName.set('Sample_30_Leads_Upload.csv');
    this.uploadValidationError.set(null);
  }

  clearSelectedFile() {
    this.selectedFileName.set('');
    this.excelRawText = '';
    this.parsedLeads.set([]);
    this.uploadValidationError.set(null);
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    this.selectedFileName.set(file.name);
    const reader = new FileReader();

    reader.onload = (e) => {
      const text = e.target?.result as string;
      this.excelRawText = text;
      this.parseCsvText(text);
    };

    reader.readAsText(file);
  }

  parseCsvText(text: string) {
    this.uploadValidationError.set(null);
    if (!text || !text.trim()) {
      this.parsedLeads.set([]);
      return;
    }

    const lines = text.trim().split('\n');
    const parsed: any[] = [];
    const missingErrors: string[] = [];

    let leadIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

    
      if (i === 0 && (line.toLowerCase().includes('first') || line.toLowerCase().includes('phone') || line.toLowerCase().includes('email'))) {
        continue;
      }

      leadIndex++;
      const parts = line.split(',').map((p) => p.trim().replace(/^["']|["']$/g, ''));
      
      const firstName = parts[0] || '';
      const lastName = parts[1] || '';
      const email = parts[2] || '';
      const phone = parts[3] || '';
      const source = parts[4] || '';

      if (!firstName || !lastName || !email || !phone || !source) {
        const missing: string[] = [];
        if (!firstName) missing.push('First Name');
        if (!lastName) missing.push('Last Name');
        if (!email) missing.push('Email');
        if (!phone) missing.push('Phone');
        if (!source) missing.push('Source');
        missingErrors.push(`Row #${leadIndex}: Missing (${missing.join(', ')})`);
      }

      parsed.push({
        firstName,
        lastName,
        email,
        phone,
        source,
      });
    }

    if (missingErrors.length > 0) {
      this.uploadValidationError.set(`Validation Error: All 5 fields (First Name, Last Name, Email, Phone, Source) are required. ${missingErrors.slice(0, 3).join(' | ')}${missingErrors.length > 3 ? ` ...and ${missingErrors.length - 3} more row(s)` : ''}`);
    }

    this.parsedLeads.set(parsed);
  }

  toggleTelecallerSelection(id: string) {
    const current = this.selectedTelecallerIds();
    if (current.includes(id)) {
      this.selectedTelecallerIds.set(current.filter((i) => i !== id));
    } else {
      this.selectedTelecallerIds.set([...current, id]);
    }
  }

  openExcelModal() {
    if (!this.canUploadLeads()) {
      alert('Access Denied: Only Digital Marketing and Admin roles are authorized to upload lead files.');
      return;
    }
    // Refresh campaigns from backend so all campaigns are loaded
    this.campaignService.loadCampaigns().subscribe();

    // Reset fields so no sample excel file is loaded by default
    this.clearSelectedFile();
    this.campaignName = '';

    const telecallers = this.activeTelecallers();
    if (telecallers.length > 0) {
      this.selectedTelecallerIds.set(telecallers.map((tc) => tc.id));
    }
    this.uploadSuccessMessage.set(null);
    this.uploadValidationError.set(null);
    this.showExcelModal.set(true);
  }

  closeExcelModal() {
    this.showExcelModal.set(false);
  }

  submitEqualAutoAssignment() {
    if (!this.canUploadLeads()) {
      alert('Access Denied: Telecallers are not permitted to upload lead files. Only Digital Marketing role can upload.');
      return;
    }

    if (!this.campaignName || !this.campaignName.trim()) {
      this.uploadValidationError.set('Please select a valid Marketing Campaign before uploading.');
      alert('Please select a Marketing Campaign before uploading.');
      return;
    }

    const leads = this.parsedLeads();
    if (leads.length === 0) {
      this.uploadValidationError.set('Please select or upload a valid lead file to assign.');
      alert('Please select or upload a valid lead file to assign.');
      return;
    }

   
    const invalidLeads = leads.filter(
      (l) => !l.firstName?.trim() || !l.lastName?.trim() || !l.email?.trim() || !l.phone?.trim() || !l.source?.trim()
    );

    if (invalidLeads.length > 0) {
      alert('Validation Error: All 5 fields (First Name, Last Name, Email, Phone, Source) are strictly required for every lead in the file. Please make sure no fields are empty.');
      return;
    }

    const selectedIds = this.selectedTelecallerIds();
    if (selectedIds.length === 0) {
      alert('Please select at least 1 active telecaller to receive the equal assignment.');
      return;
    }

    const user = this.authService.currentUser();
    const activeSelectedTcs = this.activeTelecallers().filter((tc) => selectedIds.includes(tc.id));
    const pkgName = this.packageFilterSignal() || 'CURRENT AFFAIRS AUGUST -2026';
    const prodName = pkgName.toLowerCase().includes('class') ? 'Classmate' : (pkgName.toLowerCase().includes('jesus') ? 'Jesus Messenger' : 'Careermate');

    this.leadService
      .batchImportLeads({
        leads,
        selectedTelecallerIds: selectedIds,
        telecallersList: activeSelectedTcs.map((tc) => ({ id: tc.id, fullName: tc.fullName, email: tc.email })),
        campaignName: this.campaignName,
        source: this.leadSource,
        uploaderId: user?.id,
        uploaderEmail: user?.email,
        uploaderRole: user?.role,
        creatorId: user?.id,
        creatorEmail: user?.email,
        creatorName: user?.fullName || (user?.role === 'DIGITAL_MARKETING' ? 'Digital Marketing' : 'System Administrator'),
        packageName: pkgName,
        productName: prodName,
      })
      .subscribe({
        next: (res) => {
          this.uploadSuccessMessage.set(
            `Success! ${res.totalUploaded} leads uploaded and distributed equally (${res.leadsPerTelecaller} leads each across ${res.telecallersCount} telecallers).`
          );
          this.leadService.loadLeads().subscribe();
          this.leadService.loadSummary();
          this.currentPage.set(1);
          setTimeout(() => {
            this.closeExcelModal();
            this.activeTab.set('LEADS_LIST');
          }, 1500);
        },
        error: (err) => {
          alert('Error during batch lead assignment: ' + (err?.error?.error || err?.message || 'Server error'));
        },
      });
  }


  openModal() {
    if (!this.canUploadLeads()) {
      alert('Access Denied: Only Digital Marketing and Admin roles can create leads.');
      return;
    }
    this.resetAddLeadForm();
    const cmps = this.availableCampaigns();
    if (cmps.length > 0) {
      this.newCampaignId = cmps[0].id;
      this.newCampaignName = cmps[0].name;
    } else {
      this.newCampaignId = '';
      this.newCampaignName = 'General Ad Campaign';
    }
    const tcs = this.activeTelecallers();
    if (tcs.length > 0) {
      this.newAssignedTelecallerId = tcs[0].id;
    } else {
      this.newAssignedTelecallerId = '';
    }
    this.showModal.set(true);
  }

  closeModal() {
    this.showModal.set(false);
    this.resetAddLeadForm();
  }

  resetAddLeadForm() {
    this.newFirstName = '';
    this.newLastName = '';
    this.newEmail = '';
    this.newPhone = '';
    this.newSource = 'Digital Ads Lead Form';
    this.newCampaignId = '';
    this.newCampaignName = '';
    this.newAssignedTelecallerId = '';
    this.firstNameTouched = false;
    this.lastNameTouched = false;
    this.emailTouched = false;
    this.phoneTouched = false;
    this.sourceTouched = false;
  }

  createLead() {
    this.firstNameTouched = true;
    this.lastNameTouched = true;
    this.emailTouched = true;
    this.phoneTouched = true;
    this.sourceTouched = true;

    if (!this.newFirstName.trim() || !this.newLastName.trim()) {
      alert('Validation Error: First Name and Last Name are required.');
      return;
    }
    if (!this.isPhoneValid(this.newPhone)) {
      alert('Validation Error: Please enter a valid 10-digit mobile number (e.g., +91 9876543210 or 9876543210).');
      return;
    }
    if (!this.isEmailValid(this.newEmail)) {
      alert('Validation Error: Please enter a valid email address (e.g., name@example.com).');
      return;
    }
    if (!this.newSource.trim()) {
      alert('Validation Error: Lead source is required.');
      return;
    }

    this.isCreatingLead.set(true);
    const assignedTc = this.activeTelecallers().find((t) => String(t.id).trim() === String(this.newAssignedTelecallerId).trim());

    const user = this.authService.currentUser();
    const pkgName = this.packageFilterSignal() || 'CURRENT AFFAIRS AUGUST -2026';
    const prodName = pkgName.toLowerCase().includes('class') ? 'Classmate' : (pkgName.toLowerCase().includes('jesus') ? 'Jesus Messenger' : 'Careermate');

    const payload: Partial<LeadItem> & any = {
      firstName: this.newFirstName.trim(),
      lastName: this.newLastName.trim(),
      email: this.newEmail.trim(),
      phone: this.newPhone.trim(),
      source: this.newSource.trim(),
      campaignId: this.newCampaignId || 'cmp_default',
      campaignName: this.newCampaignName || 'General Digital Ads Campaign',
      assignedTo: assignedTc ? assignedTc.id : null,
      assigneeName: assignedTc ? assignedTc.fullName : 'Unassigned',
      status: assignedTc ? 'ASSIGNED' : 'NEW',
      creatorId: user?.id,
      creatorEmail: user?.email,
      creatorName: user?.fullName || (user?.role === 'DIGITAL_MARKETING' ? 'Digital Marketing' : 'System Administrator'),
      productName: prodName,
      packageName: pkgName,
    };

    this.leadService.createLead(payload).subscribe({
      next: () => {
        this.isCreatingLead.set(false);
        this.closeModal();
      },
      error: (err) => {
        this.isCreatingLead.set(false);
        alert('Error creating lead: ' + (err?.error?.error || err?.message || 'Server error'));
      },
    });
  }

  assignLead(lead: LeadItem) {
    if (!this.canReassignLead(lead)) {
      alert('Access Denied: Only the creator who created this lead can reassign it.');
      return;
    }
    this.selectedLeadForAssign = lead;
    const users = this.realUsersList();
    const currentAssigneeId = String(lead.assignedTo || (lead as any).assigned_to || '').trim();
    const existing = users.find((u) => String(u.id).trim() === currentAssigneeId);

    if (existing) {
      this.selectedUserId = String(existing.id);
      this.assigneeName = existing.fullName;
    } else if (users.length > 0) {
      this.selectedUserId = String(users[0].id);
      this.assigneeName = users[0].fullName;
    } else {
      this.selectedUserId = '';
      this.assigneeName = 'Unassigned';
    }
  }

  onUserSelectChange(event: Event) {
    const rawVal = (event.target as HTMLSelectElement).value;
    this.onUserSelected(rawVal);
  }

  onUserSelected(userIdVal: any) {
    const userId = String(userIdVal || '').trim();
    this.selectedUserId = userId;
    const found = this.realUsersList().find((u) => String(u.id).trim() === userId);
    if (found) {
      this.assigneeName = found.fullName;
    }
  }

  confirmAssign() {
    if (!this.selectedLeadForAssign || !this.selectedUserId) return;
    const targetUserId = String(this.selectedUserId).trim();
    const foundUser = this.realUsersList().find((u) => String(u.id).trim() === targetUserId);
    const targetName = foundUser ? foundUser.fullName : (this.assigneeName || 'Assigned Telecaller');
    const user = this.authService.currentUser();
    const pkgName = this.selectedLeadForAssign.campaignName || this.packageFilterSignal() || 'CURRENT AFFAIRS AUGUST -2026';
    const prodName = pkgName.toLowerCase().includes('class') ? 'Classmate' : (pkgName.toLowerCase().includes('jesus') ? 'Jesus Messenger' : 'Careermate');

    this.leadService.assignLead(this.selectedLeadForAssign.id, targetUserId, targetName, {
      creatorName: user?.fullName || 'System Administrator',
      productName: prodName,
      packageName: pkgName,
    }).subscribe({
      next: () => {
        this.selectedLeadForAssign = null;
        this.leadService.loadLeads().subscribe();
      },
      error: (err) => {
        alert('Failed to reassign lead: ' + (err?.error?.error || err?.message || 'Server error'));
      },
    });
  }

  readonly myLeadsList = computed(() => {
    let list = this.leadService.leads();
    const user = this.authService.currentUser();
    const pkg = this.packageFilterSignal()?.toLowerCase().trim();

    if (user && user.role === 'TELECALLER') {
      list = list.filter((l) => isLeadAssignedToUser(l, user));
    } else if (pkg && pkg !== 'all') {
      const fixedProd = FIXED_PACKAGES.find((fp) => fp.name.toLowerCase() === pkg || fp.id.toLowerCase() === pkg);
      if (fixedProd) {
        const prodId = fixedProd.id.toLowerCase();
        list = list.filter((l) => {
          const src = (l.source || '').toLowerCase();
          const cmp = (l.campaignName || '').toLowerCase();
          if (prodId.includes('career')) {
            return src.includes('career') || cmp.includes('career') || cmp.includes('tn-schema') || src.includes('lead') || src.includes('excel') || src.includes('csv') || src.includes('upload') || src.includes('meta');
          }
          if (prodId.includes('class')) {
            return src.includes('class') || cmp.includes('class');
          }
          if (prodId.includes('jesus')) {
            return src.includes('jesus') || cmp.includes('jesus');
          }
          return false;
        });
      } else {
        // Specific package filtering: MUST STRICTLY MATCH THIS PACKAGE ONLY!
        list = list.filter((l) => {
          const src = (l.source || '').toLowerCase();
          const cmp = (l.campaignName || '').toLowerCase();
          const lPkg = ((l as any).packageName || (l as any).package || '').toLowerCase();
          return lPkg === pkg || src.includes(pkg) || cmp.includes(pkg);
        });
      }
    }
    return list;
  });

  readonly filteredLeadsList = computed<LeadItem[]>(() => {
    let list = this.myLeadsList();

    // 1. Status Filter
    const st = (this.filterStatus() || 'ALL').trim();
    if (st !== 'ALL') {
      const cleanSt = st.toUpperCase().replace(/[\s_-]+/g, '');
      list = list.filter((l) => {
        const leadSt = String(l.status || '').toUpperCase().replace(/[\s_-]+/g, '');
        if (leadSt === cleanSt) return true;
        if (cleanSt === 'BUSY' && (leadSt === 'LINEBUSY' || leadSt === 'BUSY')) return true;
        if (cleanSt === 'LINEBUSY' && (leadSt === 'LINEBUSY' || leadSt === 'BUSY')) return true;
        if (cleanSt === 'PAID' && (leadSt === 'PAID' || leadSt === 'QUALIFIED' || leadSt === 'CONVERTED')) return true;
        if (cleanSt === 'QUALIFIED' && (leadSt === 'PAID' || leadSt === 'QUALIFIED' || leadSt === 'CONVERTED')) return true;
        if (cleanSt === 'FOLLOWUP' && (leadSt.includes('FOLLOWUP') || leadSt === 'FOLLOWUP')) return true;
        if (cleanSt === 'WRONGNUMBER' && (leadSt === 'WRONGNUMBER' || leadSt.includes('WRONG'))) return true;
        return false;
      });
    }

    // 2. Search Query Filter
    const query = (this.searchQuery() || '').toLowerCase().trim();
    if (query) {
      const cleanDigits = query.replace(/\D/g, '');
      list = list.filter((l) => {
        const name = `${l.firstName || ''} ${l.lastName || ''}`.toLowerCase();
        const phone = String(l.phone || '').toLowerCase();
        const phoneDigits = phone.replace(/\D/g, '');
        const email = String(l.email || '').toLowerCase();
        const campaign = String(l.campaignName || (l as any).campaign_name || '').toLowerCase();
        const source = String(l.source || '').toLowerCase();
        const assignee = String(l.assigneeName || (l as any).assignee_name || '').toLowerCase();
        const status = String(l.status || '').toLowerCase().replace(/_/g, ' ');

        return (
          name.includes(query) ||
          email.includes(query) ||
          campaign.includes(query) ||
          source.includes(query) ||
          assignee.includes(query) ||
          status.includes(query) ||
          phone.includes(query) ||
          (cleanDigits.length >= 3 && phoneDigits.includes(cleanDigits))
        );
      });
    }

    // 3. Telecaller Assignment Filter
    const tc = (this.filterTelecaller() || 'ALL').trim();
    if (tc === 'UNASSIGNED') {
      list = list.filter((l) => {
        const aTo = String(l.assignedTo || (l as any).assigned_to || '').trim();
        const aName = String(l.assigneeName || (l as any).assignee_name || '').toLowerCase().trim();
        return !aTo || aName === 'unassigned' || aName === '';
      });
    } else if (tc !== 'ALL') {
      const tcVal = tc.toLowerCase();
      const allUsers = this.userMgmtService.users();
      const matchedUser = allUsers.find(
        (u) => String(u.id).trim().toLowerCase() === tcVal || (u.fullName && u.fullName.toLowerCase().trim() === tcVal)
      );
      const matchedName = matchedUser?.fullName?.toLowerCase().trim() || tcVal;
      const matchedId = String(matchedUser?.id || tc).trim().toLowerCase();

      list = list.filter((l) => {
        const lAssignedId = String(l.assignedTo || (l as any).assigned_to || '').trim().toLowerCase();
        const lAssigneeName = String(l.assigneeName || (l as any).assignee_name || '').toLowerCase().trim();

        // Numerical / string ID match
        if (lAssignedId && (lAssignedId === matchedId || lAssignedId === tcVal)) return true;

        // Exact or partial name match
        if (lAssigneeName && matchedName) {
          if (lAssigneeName === matchedName) return true;
          if (lAssigneeName.includes(matchedName) || matchedName.includes(lAssigneeName)) return true;
        }

        // Telecaller assignment match helper
        if (matchedUser && isLeadAssignedToUser(l, matchedUser)) return true;

        return false;
      });
    }

    // 4. Campaign Filter
    const cmp = (this.filterCampaign() || 'ALL').trim();
    if (cmp !== 'ALL') {
      const cmpLower = cmp.toLowerCase();
      const matchedCamp = this.availableCampaigns().find(
        (c) => String(c.id).trim() === cmp || (c.name && c.name.toLowerCase().trim() === cmpLower)
      );
      const targetCampName = (matchedCamp?.name || cmp).toLowerCase().trim();
      const targetCampId = String(matchedCamp?.id || cmp).trim().toLowerCase();

      list = list.filter((l) => {
        const lCmpId = String(l.campaignId || (l as any).campaign_id || '').trim().toLowerCase();
        const lCmpName = String(l.campaignName || (l as any).campaign_name || '').toLowerCase().trim();
        if (lCmpId && targetCampId && lCmpId === targetCampId) return true;
        if (lCmpName && (lCmpName === targetCampName || lCmpName === cmpLower)) return true;
        if (targetCampName && lCmpName && (lCmpName.includes(targetCampName) || targetCampName.includes(lCmpName))) return true;
        return false;
      });
    }

    return list;
  });

  get filteredLeads(): LeadItem[] {
    return this.filteredLeadsList();
  }

  get paginatedLeads(): LeadItem[] {
    const list = this.filteredLeadsList();
    const page = this.currentPage();
    const size = this.pageSize();
    const start = (page - 1) * size;
    return list.slice(start, start + size);
  }

  readonly totalPages = computed<number>(() => {
    const totalItems = this.filteredLeadsList().length;
    const size = this.pageSize();
    return Math.max(1, Math.ceil(totalItems / size));
  });

  hasActiveFilters(): boolean {
    return (
      (this.searchQuery() || '').trim() !== '' ||
      (this.filterStatus() || 'ALL') !== 'ALL' ||
      (this.filterTelecaller() || 'ALL') !== 'ALL' ||
      (this.filterCampaign() || 'ALL') !== 'ALL'
    );
  }

  onSearchChange(val: string): void {
    this.searchQuery.set(val);
    this.currentPage.set(1);
  }

  onStatusChange(val: string): void {
    this.filterStatus.set(val);
    this.currentPage.set(1);
  }

  onTelecallerChange(val: string): void {
    this.filterTelecaller.set(val);
    this.currentPage.set(1);
  }

  onCampaignChange(val: string): void {
    this.filterCampaign.set(val);
    this.currentPage.set(1);
  }

  setPage(page: number | string): void {
    const p = typeof page === 'number' ? page : parseInt(page, 10);
    if (!isNaN(p) && p >= 1 && p <= this.totalPages()) {
      this.currentPage.set(p);
    }
  }

  prevPage(): void {
    if (this.currentPage() > 1) {
      this.currentPage.update((p) => p - 1);
    }
  }

  nextPage(): void {
    if (this.currentPage() < this.totalPages()) {
      this.currentPage.update((p) => p + 1);
    }
  }

  setPageSize(size: number | any): void {
    const s = Number(size) || 10;
    this.pageSize.set(s);
    this.currentPage.set(1);
  }

  resetFilters(): void {
    this.searchQuery.set('');
    this.filterStatus.set('ALL');
    this.filterTelecaller.set('ALL');
    this.filterCampaign.set('ALL');
    this.currentPage.set(1);
  }

  mathMin(a: number, b: number): number {
    return Math.min(a, b);
  }

  getPageNumbers(): (number | string)[] {
    const total = this.totalPages();
    const current = this.currentPage();
    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }
    const pages: (number | string)[] = [];
    pages.push(1);
    if (current > 3) {
      pages.push('...');
    }
    const start = Math.max(2, current - 1);
    const end = Math.min(total - 1, current + 1);
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    if (current < total - 2) {
      pages.push('...');
    }
    pages.push(total);
    return pages;
  }

  getStatusBadgeClass(status?: string): string {
    const s = (status || '').toUpperCase().trim();
    switch (s) {
      case 'NEW':
        return 'status-pill-sky';
      case 'ASSIGNED':
        return 'status-pill-slate';
      case 'CONTACTED':
        return 'status-pill-indigo';
      case 'CONNECTED':
        return 'status-pill-blue';
      case 'NO_ANSWER':
        return 'status-pill-amber';
      case 'BUSY':
      case 'LINE_BUSY':
        return 'status-pill-orange';
      case 'INTERESTED':
        return 'status-pill-purple';
      case 'QUALIFIED':
        return 'status-pill-emerald';
      case 'CONVERTED':
      case 'PAID':
        return 'status-pill-teal';
      case 'NOT_INTERESTED':
        return 'status-pill-rose';
      case 'WRONG_NUMBER':
      case 'LOST':
        return 'status-pill-danger';
      default:
        return 'status-pill-slate';
    }
  }

  // Permission Check: Reassign, Edit, and Delete are strictly restricted to the lead's creator only
  isLeadCreator(lead: LeadItem): boolean {
    if (!lead) return false;
    const user = this.authService.currentUser();
    if (!user) return false;
    const userId = String(user.id !== undefined && user.id !== null ? user.id : '').trim().toLowerCase();
    const userEmail = String(user.email || '').toLowerCase().trim();
    const userName = String(user.fullName || '').toLowerCase().trim();

    const rawLead = lead as any;
    const leadCreatorId = String(
      rawLead.creatorId !== undefined && rawLead.creatorId !== null
        ? rawLead.creatorId
        : (rawLead.creator_id !== undefined && rawLead.creator_id !== null ? rawLead.creator_id : '')
    ).trim().toLowerCase();
    const leadCreatorEmail = String(rawLead.creatorEmail || rawLead.creator_email || '').toLowerCase().trim();
    const leadCreatorName = String(rawLead.creatorName || rawLead.creator_name || '').toLowerCase().trim();

    const matchesId = Boolean(userId && leadCreatorId && userId === leadCreatorId);
    const matchesEmail = Boolean(userEmail && leadCreatorEmail && userEmail === leadCreatorEmail);
    const matchesName = Boolean(userName && leadCreatorName && userName === leadCreatorName);
    const isAdmin = Boolean(user.role === 'ADMINISTRATOR');

    return matchesId || matchesEmail || matchesName || isAdmin;
  }

  canReassignLead(lead: LeadItem): boolean {
    return this.isLeadCreator(lead);
  }

  canEditOrDeleteLead(lead: LeadItem): boolean {
    return this.isLeadCreator(lead);
  }

  // Lead Details & Call History Modal State
  readonly selectedLeadForDetails = signal<LeadItem | null>(null);

  openLeadDetails(lead: LeadItem) {
    this.selectedLeadForDetails.set(lead);
  }

  closeLeadDetails() {
    this.selectedLeadForDetails.set(null);
  }

  getLeadHistoryCalls(lead: LeadItem | null): CallActivityItem[] {
    if (!lead) return [];
    const allCalls = this.leadService.calls();
    const lId = String(lead.id || '').trim().toLowerCase();
    const lPhone = String(lead.phone || '').replace(/\D/g, '');
    const lName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim().toLowerCase();

    return allCalls.filter((c) => {
      const cLeadId = String(c.leadId || '').trim().toLowerCase();
      const cPhone = String(c.leadPhone || c.phone || '').replace(/\D/g, '');
      const cLeadName = String(c.leadName || '').trim().toLowerCase();
      if (cLeadId && lId && cLeadId === lId) return true;
      if (lPhone && cPhone && lPhone === cPhone) return true;
      if (cLeadName && lName && (cLeadName === lName || cLeadName.includes(lName) || lName.includes(cLeadName))) return true;
      return false;
    });
  }

  // Edit Lead Modal State
  readonly showEditModal = signal<boolean>(false);
  readonly editingLead = signal<LeadItem | null>(null);
  readonly isSavingEdit = signal<boolean>(false);
  readonly editLeadError = signal<string | null>(null);

  editFirstName = '';
  editLastName = '';
  editEmail = '';
  editPhone = '';
  editSource = '';
  editCampaignName = '';
  editStatus = 'NEW';
  editAssignedTo = '';

  openEditLeadModal(lead: LeadItem) {
    if (!this.canEditOrDeleteLead(lead)) {
      alert('Access Denied: Only the creator who created this lead can edit it.');
      return;
    }
    this.editingLead.set(lead);
    this.editFirstName = lead.firstName || '';
    this.editLastName = lead.lastName || '';
    this.editEmail = lead.email || '';
    this.editPhone = lead.phone || '';
    this.editSource = lead.source || 'Digital Ads Lead Form';
    this.editCampaignName = lead.campaignName || '';
    this.editStatus = lead.status || 'NEW';
    this.editAssignedTo = lead.assignedTo || '';
    this.editLeadError.set(null);
    this.showEditModal.set(true);
  }

  closeEditLeadModal() {
    this.showEditModal.set(false);
    this.editingLead.set(null);
    this.editLeadError.set(null);
  }

  saveLeadEdit() {
    const lead = this.editingLead();
    if (!lead) return;

    if (!this.editFirstName.trim() || !this.editPhone.trim()) {
      this.editLeadError.set('First name and phone number are required.');
      return;
    }

    this.isSavingEdit.set(true);
    this.editLeadError.set(null);

    const tc = this.activeTelecallers().find((u) => String(u.id) === String(this.editAssignedTo));
    const assigneeName = tc ? tc.fullName : (this.editAssignedTo ? 'Telecaller' : 'Unassigned');

    this.leadService.updateLead(lead.id, {
      firstName: this.editFirstName.trim(),
      lastName: this.editLastName.trim(),
      email: this.editEmail.trim(),
      phone: this.editPhone.trim(),
      source: this.editSource.trim(),
      status: this.editStatus as any,
      campaignName: this.editCampaignName.trim(),
      assignedTo: this.editAssignedTo || null,
      assigneeName,
    }).subscribe({
      next: () => {
        this.isSavingEdit.set(false);
        this.closeEditLeadModal();
      },
      error: (err) => {
        this.isSavingEdit.set(false);
        this.editLeadError.set(err?.error?.error || err?.message || 'Failed to update lead.');
      }
    });
  }

  deleteLead(lead: LeadItem) {
    if (!this.canEditOrDeleteLead(lead)) {
      alert('Access Denied: Only the creator who created this lead can delete it.');
      return;
    }
    const leadName = `${lead.firstName} ${lead.lastName || ''}`.trim();
    if (confirm(`Are you sure you want to permanently delete lead "${leadName}"? This action cannot be undone.`)) {
      this.leadService.deleteLead(lead.id).subscribe({
        next: () => {
          // deleted successfully
        },
        error: (err) => {
          alert(err?.error?.error || err?.message || 'Failed to delete lead.');
        }
      });
    }
  }
}

