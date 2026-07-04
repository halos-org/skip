/** One selectable row in the responsive action menu (drawer or pop-over). */
export interface ActionMenuItem {
  /** Value emitted when the row is chosen. */
  id: string;
  label: string;
  /** Material icon ligature (font icon). */
  icon: string;
}
