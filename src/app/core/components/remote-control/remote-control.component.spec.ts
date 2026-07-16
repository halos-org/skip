import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Observable, Subject } from 'rxjs';
import { RemoteControlComponent } from './remote-control.component';
import { DataService, IPathUpdate, IPathUpdateWithPath } from '../../services/data.service';
import { SettingsService } from '../../services/settings.service';
import { SignalkRequestsService } from '../../services/signalk-requests.service';

describe('RemoteControlComponent', () => {
  let component: RemoteControlComponent;
  let fixture: ComponentFixture<RemoteControlComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RemoteControlComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(RemoteControlComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

/**
 * Faithful-enough DataService double for the two per-display registrations: it records each
 * acquirePath path and hands back a distinct release spy per acquire, so the release-before-rebind
 * and release-on-destroy wiring can be asserted directly.
 */
class FakeRemoteDataService {
  acquireCalls: string[] = [];
  releaseSpies: ReturnType<typeof vi.fn>[] = [];

  subscribePathTree(): Observable<IPathUpdateWithPath> {
    return new Subject<IPathUpdateWithPath>().asObservable();
  }

  acquirePath(path: string): { data$: Observable<IPathUpdate>; release: () => void } {
    this.acquireCalls.push(path);
    const release = vi.fn();
    this.releaseSpies.push(release);
    return { data$: new Subject<IPathUpdate>().asObservable(), release };
  }
}

describe('RemoteControlComponent registration release balance', () => {
  let component: RemoteControlComponent;
  let fakeData: FakeRemoteDataService;

  beforeEach(async () => {
    fakeData = new FakeRemoteDataService();
    await TestBed.configureTestingModule({
      imports: [RemoteControlComponent],
      providers: [
        { provide: DataService, useValue: fakeData },
        { provide: SettingsService, useValue: { KipUUID: 'test-uuid' } },
        { provide: SignalkRequestsService, useValue: { putRequest: vi.fn() } }
      ]
    }).compileComponents();

    // Construct without detectChanges: the constructor wires the subscriptions/effects, and we drive
    // the private rebind directly — so no template render (and no child-component DI) is needed.
    component = TestBed.createComponent(RemoteControlComponent).componentInstance;
  });

  function rebind(displayId: string | null): void {
    (component as unknown as { rebindSelectedDisplaySubscriptions(id: string | null): void })
      .rebindSelectedDisplaySubscriptions(displayId);
  }

  it('releases the two prior display registrations before rebinding to a new display', () => {
    rebind('display-1');
    expect(fakeData.acquireCalls).toEqual([
      'self.displays.display-1',
      'self.displays.display-1.screenIndex'
    ]);
    const prior = fakeData.releaseSpies.slice(); // the two display-1 handles

    rebind('display-2');

    // Both prior handles are released (release-before-rebind), and two new acquires happen.
    expect(prior[0]).toHaveBeenCalledTimes(1);
    expect(prior[1]).toHaveBeenCalledTimes(1);
    expect(fakeData.acquireCalls).toEqual([
      'self.displays.display-1',
      'self.displays.display-1.screenIndex',
      'self.displays.display-2',
      'self.displays.display-2.screenIndex'
    ]);
  });

  it('releases the two currently-held display registrations on destroy', () => {
    rebind('display-1');
    const held = fakeData.releaseSpies.slice();
    expect(held.length).toBe(2);

    (component as unknown as { ngOnDestroy(): void }).ngOnDestroy();

    expect(held[0]).toHaveBeenCalledTimes(1);
    expect(held[1]).toHaveBeenCalledTimes(1);
  });
});
