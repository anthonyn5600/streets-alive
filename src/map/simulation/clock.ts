const SIM_SECONDS_PER_REAL_SECOND = 120; // 30 real sec = 1 sim hour

export class SimClock {
  simTime = 0;
  private lastFormatted = '';

  update(realDeltaTime: number): boolean {
    this.simTime += realDeltaTime * SIM_SECONDS_PER_REAL_SECOND;
    const formatted = this.formatTime();
    if (formatted !== this.lastFormatted) {
      this.lastFormatted = formatted;
      return true;
    }
    return false;
  }

  getHour(): number {
    return Math.floor((this.simTime % 86400) / 3600);
  }

  getMinute(): number {
    return Math.floor((this.simTime % 3600) / 60);
  }

  getDay(): number {
    return Math.floor(this.simTime / 86400) + 1;
  }

  getHourFraction(): number {
    return (this.simTime % 86400) / 3600;
  }

  formatTime(): string {
    const hour = this.getHour();
    const minute = this.getMinute();
    const period = hour >= 12 ? 'PM' : 'AM';
    const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    const mm = minute.toString().padStart(2, '0');
    return `${h12}:${mm} ${period}`;
  }

  formatFull(): string {
    return `Day ${this.getDay()}, ${this.formatTime()}`;
  }
}
