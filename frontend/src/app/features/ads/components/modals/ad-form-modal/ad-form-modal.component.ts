import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CampaignItem } from '../../../../../core/services/campaign.service';

@Component({
  selector: 'app-ad-form-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ad-form-modal.component.html',
  styleUrl: './ad-form-modal.component.scss',
})
export class AdFormModalComponent {
  @Input() isOpen = false;
  @Input() isEditing = false;
  @Input() formModel: any = {};
  @Input() campaigns: CampaignItem[] = [];
  @Input() computedModalCpl = '0.00';
  @Input() computedModalCtr = '0.00';

  @Output() campaignSelected = new EventEmitter<string>();
  @Output() closeModal = new EventEmitter<void>();
  @Output() save = new EventEmitter<void>();

  onCampaignChange(campaignId: string) {
    this.campaignSelected.emit(campaignId);
  }

  onClose() {
    this.closeModal.emit();
  }

  onSave() {
    this.save.emit();
  }
}
