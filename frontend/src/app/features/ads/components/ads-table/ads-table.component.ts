import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdItem } from '../../../../core/services/campaign.service';

@Component({
  selector: 'app-ads-table',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ads-table.component.html',
  styleUrl: './ads-table.component.scss',
})
export class AdsTableComponent {
  @Input() ads: AdItem[] = [];
  @Input() canManageAds = false;

  @Output() create = new EventEmitter<void>();
  @Output() edit = new EventEmitter<AdItem>();
  @Output() delete = new EventEmitter<AdItem>();

  onCreate() {
    this.create.emit();
  }

  onEdit(ad: AdItem) {
    this.edit.emit(ad);
  }

  onDelete(ad: AdItem) {
    this.delete.emit(ad);
  }
}
