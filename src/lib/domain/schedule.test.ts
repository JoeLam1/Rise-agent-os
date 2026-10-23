import { describe, expect, it } from "vitest";
import { addDays, daysBetween, dueState, formatHours, localToday, turnaround } from "./schedule";

describe("key dates", () => {
  it("uses the brokerage's calendar day, not UTC", () => {
    // 02:30 UTC on Apr 10 is still Apr 9 in New Jersey.
    expect(localToday(new Date("2027-04-10T02:30:00Z"))).toBe("2027-04-09");
    expect(localToday(new Date("2027-04-10T16:00:00Z"))).toBe("2027-04-10");
  });

  it("counts calendar days across month ends and DST", () => {
    expect(daysBetween("2027-03-13", "2027-03-15")).toBe(2);
    expect(daysBetween("2027-04-30", "2027-05-01")).toBe(1);
    expect(daysBetween("2027-05-01", "2027-04-28")).toBe(-3);
    expect(addDays("2027-12-25", 14)).toBe("2028-01-08");
  });

  it("describes a date relative to today", () => {
    const today = "2027-04-10";
    expect(dueState("2027-04-09", false, today)).toMatchObject({ kind: "overdue", label: "Overdue by 1 day" });
    expect(dueState("2027-04-10", false, today)).toMatchObject({ kind: "today", label: "Due today" });
    expect(dueState("2027-04-11", false, today)).toMatchObject({ kind: "soon", label: "In 1 day" });
    expect(dueState("2027-04-24", false, today).kind).toBe("soon");
    expect(dueState("2027-04-25", false, today).kind).toBe("later");
    expect(dueState("2027-04-01", true, today)).toMatchObject({ kind: "done", label: "Done" });
  });
});

describe("review turnaround", () => {
  const now = new Date("2027-04-30T12:00:00Z");
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3_600_000).toISOString();

  it("takes the median over decisions in the window and ignores withdrawn reviews", () => {
    const t = turnaround(
      [
        { state: "approved", requested_at: at(10), decided_at: at(8) },
        { state: "changes_requested", requested_at: at(30), decided_at: at(24) },
        { state: "rejected", requested_at: at(50), decided_at: at(40) },
        { state: "withdrawn", requested_at: at(100), decided_at: at(1) },
        { state: "approved", requested_at: at(40 * 24), decided_at: at(39 * 24) },
        { state: "ready_for_broker", requested_at: at(5), decided_at: null },
        { state: "pending_analysis", requested_at: at(2), decided_at: null },
      ],
      now,
    );
    expect(t).toEqual({ decided: 3, medianHours: 6, waiting: 2, oldestWaitingHours: 5 });
  });

  it("reports nothing rather than zero when there is no data", () => {
    expect(turnaround([], now)).toEqual({ decided: 0, medianHours: null, waiting: 0, oldestWaitingHours: null });
    expect(formatHours(null)).toBe("—");
    expect(formatHours(0.25)).toBe("15 min");
    expect(formatHours(6)).toBe("6 h");
    expect(formatHours(72)).toBe("3 days");
  });
});
