import { Directive, ElementRef, EventEmitter, OnDestroy, Output, inject } from '@angular/core';

export interface ISkipResizeEvent {
  width: number;
  height: number;
  entry: ResizeObserverEntry;
}

@Directive({
  selector: '[skipResizeObserver]',
  standalone: true,
})
export class SkipResizeObserverDirective implements OnDestroy {
  @Output() resizeChange = new EventEmitter<ResizeObserverEntry>();
  @Output() skipResize = new EventEmitter<ISkipResizeEvent>();

  private readonly el = inject(ElementRef<HTMLElement>);

  private ro: ResizeObserver | null = null;

  constructor() {
    this.ro = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      const { width, height } = entry.contentRect;
      this.resizeChange.emit(entry);
      this.skipResize.emit({ width, height, entry });
    });

    this.ro.observe(this.el.nativeElement);
  }

  ngOnDestroy(): void {
    this.ro?.disconnect();
    this.ro = null;
  }
}
