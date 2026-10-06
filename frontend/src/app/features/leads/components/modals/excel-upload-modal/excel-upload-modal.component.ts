import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-excel-upload-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './excel-upload-modal.component.html',
  styleUrl: './excel-upload-modal.component.scss',
})
export class ExcelUploadModalComponent {
  @Input() isOpen = false;
  @Input() campaignName = '';
  @Input() availableCampaigns: { id: string; name: string }[] = [];
  @Input() selectedFileName = '';
  @Input() parsedLeads: any[] = [];
  @Input() uploadSuccessMessage: string | null = null;
  @Input() uploadValidationError: string | null = null;
  @Input() activeTelecallers: any[] = [];
  @Input() selectedTelecallerIds: string[] = [];

  @Output() campaignNameChange = new EventEmitter<string>();
  @Output() fileSelected = new EventEmitter<Event>();
  @Output() clearFile = new EventEmitter<void>();
  @Output() toggleTelecaller = new EventEmitter<string>();
  @Output() closeModal = new EventEmitter<void>();
  @Output() submit = new EventEmitter<void>();

  onCampaignChange(name: string) {
    this.campaignNameChange.emit(name);
  }

  onFile(event: Event) {
    this.fileSelected.emit(event);
  }

  onClearFile() {
    this.clearFile.emit();
  }

  onToggleTc(id: string) {
    this.toggleTelecaller.emit(id);
  }

  onClose() {
    this.closeModal.emit();
  }

  onSubmit() {
    this.submit.emit();
  }
}
