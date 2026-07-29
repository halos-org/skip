import { ComponentType } from "@angular/cdk/portal";
import type { IPageSwitchTrigger } from "../services/dashboard.service";

export interface DialogConfirmationData {
  title: string;
  message: string;
  confirmBtnText?: string;
  cancelBtnText: string;
}

export interface DialogComponentData {
  title: string;
  component: string;
  iconHref?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  componentType?: ComponentType<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any;
}

export interface DialogNameData {
  title: string;
  name: string;
  confirmBtnText?: string;
  cancelBtnText: string;
}

export interface DialogDashboardPageEditorData {
  title: string;
  name: string;
  icon?: string;
  /** When true, the dialog shows the auto-show trigger editor (edit flow only). */
  enableTrigger?: boolean;
  /** Current auto-show trigger for the edit flow; null/undefined = none. Read back on save. */
  trigger?: IPageSwitchTrigger | null;
  confirmBtnText?: string;
  cancelBtnText: string;
}

export interface DialogWidgetOptionsData {
  title: string;
  config: object;
  confirmBtnText: string;
  cancelBtnText: string;
}
