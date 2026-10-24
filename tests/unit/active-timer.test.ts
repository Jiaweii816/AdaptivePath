import { describe, expect, it } from "vitest";
import {
  ActiveTimer,
  IDLE_THRESHOLD_MS,
  MAX_SESSION_CAP_SECONDS,
} from "@/features/workbench/active-timer";

function timer(start = 0) {
  let now = start;
  return {
    setNow(value: number) {
      now = value;
    },
    instance: new ActiveTimer({ now: () => now }),
  };
}

describe("ActiveTimer", () => {
  it("accumulates short active intervals", () => {
    const subject = timer();

    subject.setNow(30_000);
    subject.instance.recordActivity();
    subject.setNow(60_000);

    expect(subject.instance.elapsedSeconds()).toBe(60);
  });

  it("drops idle intervals over the threshold", () => {
    const subject = timer();

    subject.setNow(IDLE_THRESHOLD_MS + 1);
    subject.instance.recordActivity();

    expect(subject.instance.elapsedSeconds()).toBe(0);
  });

  it("does not count hidden or blurred time", () => {
    const subject = timer();

    subject.setNow(30_000);
    subject.instance.pause();
    subject.setNow(90_000);
    subject.instance.resume();
    subject.setNow(120_000);

    expect(subject.instance.elapsedSeconds()).toBe(60);
  });

  it("caps extreme sessions", () => {
    const subject = new ActiveTimer({
      idleThresholdMs: Number.MAX_SAFE_INTEGER,
      now: () => 0,
    });

    expect(subject.elapsedSeconds((MAX_SESSION_CAP_SECONDS + 100) * 1000)).toBe(
      MAX_SESSION_CAP_SECONDS,
    );
  });

  it("resets for the next attempt", () => {
    const subject = timer();

    subject.setNow(30_000);
    subject.instance.recordActivity();
    subject.instance.reset();

    expect(subject.instance.elapsedSeconds()).toBe(0);
  });
});
