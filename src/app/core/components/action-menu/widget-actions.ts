import { ActionMenuItem } from './action-menu-item';

/** Actions offered by the edit-mode widget/group action menu. */
export const WIDGET_ACTIONS: ActionMenuItem[] = [
  { id: 'settings', label: 'Settings', icon: 'settings' },
  { id: 'duplicate', label: 'Duplicate', icon: 'add_to_photos' },
  { id: 'copy', label: 'Copy', icon: 'content_copy' },
  { id: 'cut', label: 'Cut', icon: 'content_cut' },
  { id: 'delete', label: 'Delete', icon: 'delete_forever' },
];
