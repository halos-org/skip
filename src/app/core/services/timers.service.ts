import { Injectable, OnDestroy } from '@angular/core';

import { BehaviorSubject, Observable } from 'rxjs';


interface ISkipTimer {
  currentValue: BehaviorSubject<number>;
  timeoutID: ReturnType<typeof setInterval> | null;
  intervalMS: number;
}

type ISkipTimers = Record<string, ISkipTimer>;

@Injectable({
  providedIn: 'root'
})
export class TimersService implements OnDestroy {

  skipTimers: ISkipTimers = {};

  constructor() {

  }

  /**
   * Create service timer. The timer notification schedules is based on the timerInterval value and
   * the number of count to apply. Adjust the interval according to the use case and reduce
   * unnecessary app events. A timerInterval of 1000 ms with count of 60 is 60 * 1000ms =
   * 1 minutes and would generate a Subject event and Observer processing every second.
   *
   * @param {string} timerName Used as the ID id the timer
   * @param {number} count Number of steps to execute. This number is a factor of timerInterval. Use negative values to countdown
   * @param {number} timerInterval Count interval in milliseconds
   * @return {*}  {Observable<number>} Timer count value as a number
   * @memberof TimersService
   */
  public createTimer(timerName: string, count: number, timerInterval: number): Observable<number> {
    // return if exists
    if (timerName in this.skipTimers) {
      return this.skipTimers[timerName].currentValue.asObservable();
    }
    // create it
    this.skipTimers[timerName] = {
      currentValue: new BehaviorSubject<number>(count),
      timeoutID: null,
      intervalMS: timerInterval
    }
    return this.skipTimers[timerName].currentValue.asObservable();
  }



  public startTimer(timerName: string) {
    if (!Object.prototype.hasOwnProperty.call(this.skipTimers, timerName)) { return; }

    if (this.skipTimers[timerName].timeoutID !== null) { return } // already running

    this.skipTimers[timerName].timeoutID = setInterval(() => {
      this.skipTimers[timerName].currentValue.next(this.skipTimers[timerName].currentValue.value + 1)
    }, this.skipTimers[timerName].intervalMS);
  }

  public stopTimer(timerName: string) {
    if (!Object.prototype.hasOwnProperty.call(this.skipTimers, timerName)) { return; }
    if (this.skipTimers[timerName].timeoutID === null) { return; } // already Stopped
    clearInterval(this.skipTimers[timerName].timeoutID);
    this.skipTimers[timerName].timeoutID = null;
  }


  public setTimer(timerName: string, timerValue: number) {
    if (!Object.prototype.hasOwnProperty.call(this.skipTimers, timerName)) { return; }
    this.skipTimers[timerName].currentValue.next(timerValue);
  }


  public deleteTimer(timerName: string) {
    if (!Object.prototype.hasOwnProperty.call(this.skipTimers, timerName)) { return; }
    this.stopTimer(timerName);
    this.skipTimers[timerName].currentValue.complete();
    delete this.skipTimers[timerName];
  }


  public isRunning(timerName: string) : boolean {
    let running = false;
    if (timerName in this.skipTimers) {
      running = this.skipTimers[timerName].timeoutID === null ? false : true;
    };

    return running;
  }

  /**
   * Clear all active intervals on service destroy to prevent orphan callbacks
   * retaining references to large graphs / widget subjects.
   */
  ngOnDestroy(): void {
    Object.keys(this.skipTimers).forEach(name => {
      if (this.skipTimers[name].timeoutID) {
        clearInterval(this.skipTimers[name].timeoutID);
        this.skipTimers[name].timeoutID = null;
      }
      // Complete any subjects to release observers
      this.skipTimers[name].currentValue.complete();
    });
    this.skipTimers = {};
  }


}
