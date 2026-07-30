import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import type { DialogDashboardPageEditorData } from '../../interfaces/dialog-data';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { SelectIconComponent } from '../select-icon/select-icon.component';
import { DataService } from '../../services/data.service';
import { IPageSwitchTrigger } from '../../services/dashboard.service';

/** A path value the user can pick as a trigger: the string we store plus a friendly label. */
interface ValueOption {
  value: string;
  label: string;
}

const MAX_PATH_SUGGESTIONS = 50;

@Component({
  selector: 'dialog-dashboard-page-editor',
  standalone: true,
  imports: [MatDialogModule, MatIconModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatAutocompleteModule, MatCheckboxModule, FormsModule, SelectIconComponent],
  templateUrl: './dialog-dashboard-page-editor.component.html',
  styleUrl: './dialog-dashboard-page-editor.component.scss'
})
export class DialogDashboardPageEditorComponent {
  protected dialogRef = inject<MatDialogRef<DialogDashboardPageEditorComponent>>(MatDialogRef);
  protected data = inject<DialogDashboardPageEditorData>(MAT_DIALOG_DATA);
  private readonly _data = inject(DataService);

  protected triggerEnabled = false;
  protected triggerPath = '';
  protected triggerValue = '';
  private readonly _pathOptions: string[] = [];
  private _valueOptions: ValueOption[] = [];

  constructor() {
    if (!this.data.icon) {
      this.data.icon = 'dashboard-dashboard';
    }
    const trigger = this.data.trigger;
    if (trigger) {
      this.triggerEnabled = true;
      this.triggerPath = trigger.path;
      this.triggerValue = trigger.value;
    }
    this._pathOptions = this._data.getCachedPaths(true).slice().sort((a, b) => a.localeCompare(b));
    this.refreshValueOptions();
  }

  /** Paths matching the current input; capped so the list stays usable. */
  protected get filteredPaths(): string[] {
    const needle = this.triggerPath.trim().toLowerCase();
    const matches = needle ? this._pathOptions.filter(p => p.toLowerCase().includes(needle)) : this._pathOptions;
    return matches.slice(0, MAX_PATH_SUGGESTIONS);
  }

  /** Known values for the chosen path, filtered by what the user has typed. */
  protected get filteredValueOptions(): ValueOption[] {
    const needle = this.triggerValue.trim().toLowerCase();
    if (!needle) return this._valueOptions;
    return this._valueOptions.filter(o => o.value.toLowerCase().includes(needle) || o.label.toLowerCase().includes(needle));
  }

  /** Re-read the chosen path's possibleValues, but keep whatever value the user already entered. */
  protected onPathChange(): void {
    this.refreshValueOptions();
  }

  protected onIconSelected(icon: string): void {
    this.data.icon = icon;
  }

  protected save(): void {
    // Only touch the trigger when this dialog is in the trigger-editing flow, so the
    // New Page / Duplicate flows leave it untouched.
    if (this.data.enableTrigger) {
      this.data.trigger = this.buildTrigger();
    }
    this.dialogRef.close(this.data);
  }

  private refreshValueOptions(): void {
    const meta = this.triggerPath.trim() ? this._data.getPathMeta(this.triggerPath.trim()) : null;
    // Store the String()-coerced value (never the human title) so it matches the live path value.
    this._valueOptions = (meta?.possibleValues ?? []).map(pv => ({
      value: String(pv.value),
      label: pv.title ?? String(pv.value)
    }));
  }

  private buildTrigger(): IPageSwitchTrigger | null {
    if (!this.triggerEnabled) return null;
    const path = this.triggerPath.trim();
    const value = this.triggerValue.trim();
    if (!path || !value) return null;
    return { path, value };
  }
}
