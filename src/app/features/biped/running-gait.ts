// Contact masks at 120 Hz: 0 = airborne, 1/2 = only one foot, 3 = both.
type Support = 0 | 1 | 2 | 3;
const MIN_STANCE = 4; // 33 ms of exclusive contact on each side of the flight
const MIN_FLIGHT = 7;

function single(support: Support): support is 1 | 2 {
  return support === 1 || support === 2;
}

export class RunningGait {
  alternating = 0;
  otherFlights = 0;
  longestStreak = 0;
  private grounded = false;
  private support: Support = 0;
  private stance = 0;
  private airborne = 0;
  private launch: 1 | 2 | null = null;
  private landing: 1 | 2 | null = null;
  private lastLanding: 1 | 2 | null = null;
  private streak = 0;

  observe(left: boolean, right: boolean) {
    const support = (left ? (right ? 3 : 1) : right ? 2 : 0) satisfies Support;
    if (this.landing !== null && support !== this.landing) this.rejectFlight();
    if (support === 0) {
      if (this.support !== 0) {
        this.launch = single(this.support) && this.stance >= MIN_STANCE ? this.support : null;
      }
      this.airborne++;
    } else {
      if (this.grounded && this.airborne >= MIN_FLIGHT) {
        if (this.launch !== null && single(support) && support !== this.launch) {
          this.landing = support;
        } else {
          this.rejectFlight();
        }
      }
      this.grounded = true;
      this.airborne = 0;
    }

    this.stance = support === this.support ? this.stance + 1 : 1;
    this.support = support;
    if (this.landing !== null && this.stance >= MIN_STANCE) {
      this.alternating++;
      this.streak = this.lastLanding === this.launch ? this.streak + 1 : 1;
      this.lastLanding = this.landing;
      this.longestStreak = Math.max(this.longestStreak, this.streak);
      this.landing = null;
    }
  }

  qualifies(strides: number) {
    return this.longestStreak >= strides && this.alternating >= 2 * this.otherFlights;
  }

  private rejectFlight() {
    this.otherFlights++;
    this.streak = 0;
    this.lastLanding = null;
    this.landing = null;
  }
}
