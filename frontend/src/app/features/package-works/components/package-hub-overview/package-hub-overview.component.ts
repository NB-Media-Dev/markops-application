import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OperationDepartment } from '../../package-works.component';

@Component({
  selector: 'app-package-hub-overview',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './package-hub-overview.component.html',
  styleUrl: './package-hub-overview.component.scss',
})
export class PackageHubOverviewComponent {
  @Input() packageMetrics: any = null;
  @Input() operationDepartments: OperationDepartment[] = [];

  @Output() departmentSelect = new EventEmitter<string>();

  onSelectDepartment(deptId: string) {
    this.departmentSelect.emit(deptId);
  }
}
